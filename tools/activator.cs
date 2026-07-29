using System;
using System.Runtime.InteropServices;

namespace DreamSkinActivator {
    [ComImport, Guid("1762a24d-7864-4f9e-9258-54a3664ddcf5"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                                [MarshalAs(UnmanagedType.LPWStr)] string args,
                                uint options,
                                out uint processId);
    }

    [ComImport, Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")]
    public class ApplicationActivationManager {}

    class Program {
        [DllImport("combase.dll", CallingConvention = CallingConvention.StdCall)]
        static extern int RoInitialize(int initType);

        [DllImport("ole32.dll")]
        static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

        [DllImport("ole32.dll")]
        static extern int CoCreateInstance(ref Guid clsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out object ppv);

        const int RO_INIT_MULTITHREADED = 1;
        const uint CLSCTX_LOCAL_SERVER = 0x4;
        const uint CLSCTX_INPROC_SERVER = 0x1;
        static readonly Guid CLSID_AAM = new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c");
        static readonly Guid IID_IUnknown = new Guid("00000000-0000-0000-C000-000000000046");
        static readonly Guid IID_IAAM = new Guid("1762a24d-7864-4f9e-9258-54a3664ddcf5");

        static int Main(string[] args) {
            if (args.Length < 1) {
                Console.Error.WriteLine("Usage: activator <AppId> [args]");
                return 1;
            }
            string appId = args[0];
            string appArgs = args.Length > 1 ? args[1] : "";

            // Initialize Windows Runtime (MTA) - required for WinRT classes
            int roHr = RoInitialize(RO_INIT_MULTITHREADED);
            Console.WriteLine("RoInitialize HR=0x" + roHr.ToString("X8") + " (0=S_OK, 1=S_FALSE=already)");

            // Also init COM
            int coHr = CoInitializeEx(IntPtr.Zero, 0);
            Console.WriteLine("CoInitializeEx HR=0x" + coHr.ToString("X8"));

            try {
                // Method 1: CoCreateInstance with explicit IID (bypass CLR QueryInterface)
                Console.WriteLine("--- Method 1: CoCreateInstance(IAAM) ---");
                object obj1;
                Guid clsid = CLSID_AAM;
                Guid iid_iaam = IID_IAAM;
                int hr1 = CoCreateInstance(ref clsid, IntPtr.Zero, CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER, ref iid_iaam, out obj1);
                Console.WriteLine("CoCreateInstance(IAAM) HR=0x" + hr1.ToString("X8"));
                if (hr1 == 0 && obj1 != null) {
                    var iam1 = (IApplicationActivationManager)obj1;
                    uint pid1;
                    int actHr1 = iam1.ActivateApplication(appId, appArgs, 0, out pid1);
                    Console.WriteLine("Activate HR=0x" + actHr1.ToString("X8") + " PID=" + pid1);
                    Marshal.ReleaseComObject(obj1);
                    if (actHr1 == 0) { Console.WriteLine("SUCCESS via Method 1"); return 0; }
                }

                // Method 2: CoCreateInstance(IUnknown) then QueryInterface
                Console.WriteLine("--- Method 2: CoCreateInstance(IUnknown) + QI ---");
                object obj2;
                Guid iid_unk = IID_IUnknown;
                int hr2 = CoCreateInstance(ref clsid, IntPtr.Zero, CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER, ref iid_unk, out obj2);
                Console.WriteLine("CoCreateInstance(IUnknown) HR=0x" + hr2.ToString("X8"));
                if (hr2 == 0 && obj2 != null) {
                    IntPtr pUnk = Marshal.GetIUnknownForObject(obj2);
                    IntPtr pIAAM;
                    Guid iid_aam = IID_IAAM;
                    int qiHr = Marshal.QueryInterface(pUnk, ref iid_aam, out pIAAM);
                    Console.WriteLine("QueryInterface(IAAM) HR=0x" + qiHr.ToString("X8"));
                    if (qiHr == 0 && pIAAM != IntPtr.Zero) {
                        object iam2 = Marshal.GetObjectForIUnknown(pIAAM);
                        var mgr2 = (IApplicationActivationManager)iam2;
                        uint pid2;
                        int actHr2 = mgr2.ActivateApplication(appId, appArgs, 0, out pid2);
                        Console.WriteLine("Activate HR=0x" + actHr2.ToString("X8") + " PID=" + pid2);
                        Marshal.Release(pIAAM);
                        Marshal.Release(pUnk);
                        if (actHr2 == 0) { Console.WriteLine("SUCCESS via Method 2"); return 0; }
                    } else {
                        Console.WriteLine("QueryInterface FAILED - object does not expose IAAM");
                        // Dump all interfaces via IDispatch check
                        Guid iid_idispatch = new Guid("00020400-0000-0000-C000-000000000046");
                        IntPtr pDisp;
                        int dispHr = Marshal.QueryInterface(pUnk, ref iid_idispatch, out pDisp);
                        Console.WriteLine("IDispatch support: HR=0x" + dispHr.ToString("X8"));
                        if (dispHr == 0) Marshal.Release(pDisp);
                        Marshal.Release(pUnk);
                    }
                }

                // Method 3: Try RoActivateInstance (WinRT activation)
                Console.WriteLine("--- Method 3: RoActivateInstance ---");
                try {
                    var mgr3 = new ApplicationActivationManager();
                    Console.WriteLine("new ApplicationActivationManager() succeeded: " + mgr3.GetType().FullName);
                    var iam3 = (IApplicationActivationManager)mgr3;
                    uint pid3;
                    int actHr3 = iam3.ActivateApplication(appId, appArgs, 0, out pid3);
                    Console.WriteLine("Activate HR=0x" + actHr3.ToString("X8") + " PID=" + pid3);
                    if (actHr3 == 0) { Console.WriteLine("SUCCESS via Method 3"); return 0; }
                } catch (Exception e3) {
                    Console.WriteLine("Method 3 exception: " + e3.GetType().Name + ": " + e3.Message);
                    if (e3.InnerException != null) Console.WriteLine("  Inner: " + e3.InnerException.Message);
                }

                Console.Error.WriteLine("All methods failed");
                return -2;
            } catch (Exception e) {
                Console.Error.WriteLine("Exception: " + e.Message);
                return -1;
            }
        }
    }
}
