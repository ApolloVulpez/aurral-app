using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aurral.App;

internal sealed class WindowActivation(string pipeName) : IDisposable
{
    private const byte ShowWindowRequest = 1;
    private readonly NamedPipeServerStream pipe = new(pipeName, PipeDirection.In, 1,
        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

    internal static bool TryForwardLaunch(string pipeName)
    {
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out,
            PipeOptions.CurrentUserOnly);
        try
        {
            client.Connect(250);
            if (GetNamedPipeServerProcessId(client.SafePipeHandle, out var processId))
                AllowSetForegroundWindow(processId);
            client.WriteByte(ShowWindowRequest);
            return true;
        }
        catch (Exception error) when (error is IOException or TimeoutException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    // Started on the UI thread so activation runs on the window's message loop.
    internal void Listen(Action showWindow) => _ = ListenAsync(showWindow);

    private async Task ListenAsync(Action showWindow)
    {
        var request = new byte[1];
        try
        {
            while (true)
            {
                await pipe.WaitForConnectionAsync();
                bool activate;
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1)))
                {
                    try
                    {
                        activate = await pipe.ReadAsync(request, timeout.Token) == 1 && request[0] == ShowWindowRequest;
                    }
                    catch (Exception error) when (error is IOException or OperationCanceledException)
                    {
                        activate = false;
                    }
                }
                pipe.Disconnect();
                if (activate) showWindow();
            }
        }
        catch (Exception error) when (error is ObjectDisposedException or IOException) { }
    }

    public void Dispose() => pipe.Dispose();

    [DllImport("kernel32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeServerProcessId(SafePipeHandle connection, out uint serverProcessId);

    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(uint processId);
}
