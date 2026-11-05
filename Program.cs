using System.Runtime.InteropServices;

namespace Aurral.App;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        SetCurrentProcessExplicitAppUserModelID("Aurral.Desktop");
        ApplicationConfiguration.Initialize();
        Application.Run(new MainWindow());
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
