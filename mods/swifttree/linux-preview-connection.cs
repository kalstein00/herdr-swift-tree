using System;
using System.Globalization;
using System.Text;
using System.Threading.Tasks;

// Each range is a separate RPC. Keep one RPC on the original SSH line until
// the final range is verified, so reconnect cannot silently resume a document.
internal sealed class SwiftTreeLinuxPreviewConnection : IDisposable
{
    private const string WatchScript = @"
idle=0
done=0
trap 'exit 1' HUP INT TERM
trap 'done=1' USR1
trap 'idle=0' USR2
exec 9</dev/null
while [ ""$done"" -eq 0 ] && [ ""$idle"" -lt 75 ]; do
    sleep 0.2
    idle=$((idle + 1))
done
[ ""$done"" -eq 1 ]
";

    // Descriptor 9 is published after the signal handlers are installed and
    // disappears with the process, including after a forced Core shutdown.
    private const string LocateScript = @"
watch_pid() {
    ps -ww -e -o pid=,args= | while read -r pid arguments; do
        case ""$arguments"" in
            *"" swifttree-preview-watch $1"") [ ! -e ""/proc/$pid/fd/9"" ] || { printf '%s\n' ""$pid""; break; } ;;
        esac
    done
}
";
    private const string ReadyScript = LocateScript + @"
attempt=0
while [ ""$attempt"" -lt 35 ]; do
    pid=$(watch_pid ""$1"")
    if [ -n ""$pid"" ]; then printf '%s\n' ""$pid""; exit 0; fi
    sleep 0.1
    attempt=$((attempt + 1))
done
exit 1";
    private const string ReleaseScript = LocateScript + @"
pid=$(watch_pid ""$1"")
[ -n ""$pid"" ] && kill -TERM ""$pid""
";

    private readonly SwiftTreeWindowsCoreBridge core;
    private readonly string machine;
    private readonly Task<SwiftTreeWindowsCoreBridge.CoreResult> watch;
    private bool completed;

    public SwiftTreeLinuxPreviewConnection(SwiftTreeWindowsCoreBridge core, string machine)
    {
        this.core = core;
        this.machine = machine;
        Token = Guid.NewGuid().ToString("N");
        watch = Task.Run(() => core.Execute(machine,
            new[] { "sh", "-c", WatchScript, "swifttree-preview-watch", Token }, 600, dedicated: true));
    }

    public string Token { get; private set; }
    public string Pid { get; private set; }

    public void WaitUntilReady()
    {
        var ready = core.Execute(machine, Command(ReadyScript), 5);
        int pid;
        if (!Succeeded(ready) || ready.stdout == null ||
            !Int32.TryParse(Encoding.ASCII.GetString(Convert.FromBase64String(ready.stdout)).Trim(),
                NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid <= 0) throw Interrupted();
        Pid = pid.ToString(CultureInfo.InvariantCulture);
        Check();
    }

    public void Check()
    {
        if (watch.IsCompleted) throw Interrupted();
    }

    public void Complete()
    {
        if (!Succeeded(watch.GetAwaiter().GetResult())) throw Interrupted();
        completed = true;
    }

    public void Dispose()
    {
        if (!completed) Task.Run(() => core.Execute(machine, Command(ReleaseScript), 5));
    }

    private string[] Command(string script) { return new[] { "sh", "-c", script, "swifttree-preview", Token }; }

    private static bool Succeeded(SwiftTreeWindowsCoreBridge.CoreResult reply)
    {
        return reply != null && reply.code == 0 && !reply.timed_out && !reply.truncated;
    }

    private static SwiftTreeLinuxPreviewException Interrupted()
    {
        return new SwiftTreeLinuxPreviewException("SSH preview connection interrupted. Reopen the file to try again.");
    }
}
