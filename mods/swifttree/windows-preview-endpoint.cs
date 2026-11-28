using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class SwiftTreePreviewEndpoint
{
    public int port { get; set; }
    public string token { get; set; }
    public int hostPid { get; set; }
    public long hostStarted { get; set; }
    public string build { get; set; }

    public string StopEventName
    {
        get { return String.Format(CultureInfo.InvariantCulture, @"Local\SwiftTree-preview-exit-{0}-{1}", hostPid, hostStarted); }
    }

    public static SwiftTreePreviewEndpoint Read(string path)
    {
        try { return new JavaScriptSerializer().Deserialize<SwiftTreePreviewEndpoint>(File.ReadAllText(path)); }
        catch (IOException) { return null; }
        catch (ArgumentException) { return null; }
    }

    public Process OpenHost()
    {
        Process host = null;
        try
        {
            host = Process.GetProcessById(hostPid);
            if (!host.HasExited && host.StartTime.ToFileTimeUtc() == hostStarted) return host;
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        if (host != null) host.Dispose();
        return null;
    }

    public bool Stop(Process host)
    {
        EventWaitHandle stop;
        if (!EventWaitHandle.TryOpenExisting(StopEventName, out stop)) return host.WaitForExit(5000);
        using (stop) stop.Set();
        return host.WaitForExit(5000);
    }
}
