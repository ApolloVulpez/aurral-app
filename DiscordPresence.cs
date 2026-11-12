using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text.Json;

namespace Aurral.App;

internal sealed class DiscordPresence(string clientId) : IDisposable
{
    private const int MaxFrameSize = 64 * 1024;
    private readonly SemaphoreSlim writer = new(1, 1);
    private NamedPipeClientStream? pipe;
    private string? lastActivity;
    private DateTime nextAttempt;
    private int revision;

    internal bool Connected { get; private set; }

    internal static string ReadResource(string name)
    {
        using var stream = typeof(DiscordPresence).Assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd().Trim();
    }

    internal async Task UpdateAsync(JsonElement? activity)
    {
        if (!Connected)
        {
            if (activity is null || DateTime.UtcNow < nextAttempt) return;
            nextAttempt = DateTime.UtcNow.AddSeconds(10);
            await ConnectAsync();
        }

        if (!Connected || pipe is not { } connection) return;
        var serialized = activity?.GetRawText() ?? "null";
        if (lastActivity == serialized) return;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            var command = new { cmd = "SET_ACTIVITY", args = new { pid = Environment.ProcessId, activity }, nonce = Guid.NewGuid() };
            await WriteFrameAsync(connection, 1, JsonSerializer.SerializeToUtf8Bytes(command), timeout.Token);
            if (pipe == connection) lastActivity = serialized;
        }
        catch (Exception error) when (IsConnectionError(error))
        {
            Close(connection);
        }
    }

    private async Task ConnectAsync()
    {
        var startingRevision = revision;
        for (var index = 0; index < 10 && startingRevision == revision; index++)
        {
            var connection = new NamedPipeClientStream(".", $"discord-ipc-{index}", PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            pipe = connection;
            try
            {
                await connection.ConnectAsync(100);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await WriteFrameAsync(connection, 0, JsonSerializer.SerializeToUtf8Bytes(new { v = 1, client_id = clientId }), timeout.Token);
                var (opcode, payload) = await ReadFrameAsync(connection, timeout.Token);
                using var reply = JsonDocument.Parse(payload);
                if (opcode == 1 && IsMessage(reply.RootElement, "cmd", "DISPATCH") && IsMessage(reply.RootElement, "evt", "READY") &&
                    pipe == connection)
                {
                    Connected = true;
                    _ = ReadRepliesAsync(connection);
                    return;
                }
            }
            catch (Exception error) when (IsConnectionError(error)) { }
            Close(connection);
        }
    }

    private async Task ReadRepliesAsync(NamedPipeClientStream connection)
    {
        try
        {
            while (pipe == connection)
            {
                var (opcode, payload) = await ReadFrameAsync(connection, CancellationToken.None);
                if (opcode == 2) break;
                if (opcode == 3) await WriteFrameAsync(connection, 4, payload, CancellationToken.None);
                if (opcode != 1) continue;
                using var reply = JsonDocument.Parse(payload);
                if (IsMessage(reply.RootElement, "evt", "ERROR")) break;
            }
        }
        catch (Exception error) when (IsConnectionError(error)) { }
        finally { Close(connection); }
    }

    private async Task WriteFrameAsync(NamedPipeClientStream connection, int opcode, byte[] payload, CancellationToken cancellation)
    {
        var frame = new byte[8 + payload.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame, opcode);
        BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(4), payload.Length);
        payload.CopyTo(frame, 8);
        await writer.WaitAsync(cancellation);
        try { await connection.WriteAsync(frame, cancellation); }
        finally { writer.Release(); }
    }

    private static async Task<(int Opcode, byte[] Payload)> ReadFrameAsync(Stream connection, CancellationToken cancellation)
    {
        var header = new byte[8];
        await connection.ReadExactlyAsync(header, cancellation);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(4));
        if (length is < 0 or > MaxFrameSize) throw new InvalidDataException("Invalid Discord IPC frame size.");
        var payload = new byte[length];
        await connection.ReadExactlyAsync(payload, cancellation);
        return (BinaryPrimitives.ReadInt32LittleEndian(header), payload);
    }

    private static bool IsMessage(JsonElement message, string property, string value) =>
        message.ValueKind == JsonValueKind.Object && message.TryGetProperty(property, out var field) &&
        field.ValueKind == JsonValueKind.String && field.ValueEquals(value);

    private static bool IsConnectionError(Exception error) =>
        error is IOException or InvalidDataException or InvalidOperationException or TimeoutException or
            OperationCanceledException or UnauthorizedAccessException or JsonException;

    private void Close(NamedPipeClientStream connection)
    {
        if (pipe == connection)
        {
            pipe = null;
            Connected = false;
            lastActivity = null;
        }
        connection.Dispose();
    }

    public void Dispose()
    {
        revision++;
        nextAttempt = default;
        if (pipe is { } connection) Close(connection);
    }
}
