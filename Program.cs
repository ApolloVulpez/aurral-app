using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Aurral.App;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var identity = WindowsIdentity.GetCurrent();
        using var process = Process.GetCurrentProcess();
        var instanceName = $"Aurral.Desktop.{process.SessionId}.{identity.User!.Value}";
        using var instance = new Mutex(false, $@"Local\{instanceName}");

        // A second launch can arrive while the first is starting or closing.
        var deadline = Stopwatch.StartNew();
        do
        {
            if (TryTakeOwnership(instance))
            {
                try { RunPrimary(instanceName); }
                finally { instance.ReleaseMutex(); }
                return;
            }
            if (WindowActivation.TryForwardLaunch(instanceName)) return;
            Thread.Sleep(50);
        } while (deadline.Elapsed < TimeSpan.FromSeconds(5));
    }

    private static bool TryTakeOwnership(Mutex instance)
    {
        try { return instance.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
    }

    private static void RunPrimary(string instanceName)
    {
        SetCurrentProcessExplicitAppUserModelID("Aurral.Desktop");
        ApplicationConfiguration.Initialize();
        using var window = new MainWindow();
        using var activation = new WindowActivation(instanceName);
        window.Shown += (_, _) => activation.Listen(window.ShowExistingWindow);
        Application.Run(window);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
