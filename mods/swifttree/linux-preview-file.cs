using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal sealed class SwiftTreeLinuxPreviewFile : ISwiftTreePreviewFile
{
    public const int RangeBytes = 1024 * 1024;
    private const int RangeTimeout = 8;
    private const int ChecksumRequest = -1;
    private const string ReadScript = @"
export LC_ALL=C TZ=UTC
file_version() { stat -L -c '%d|%i|%s|%y|%z' -- ""$1""; }
[ -f ""$1"" ] || exit 44
exec 3< ""$1""
fd=/proc/$$/fd/3
[ -f ""$fd"" ] || exit 44
version=$(file_version ""$fd"") || exit 44
[ -z ""$4"" ] || [ ""$version"" = ""$4"" ] || exit 46
printf '%s\n' ""$version""
if [ ""$3"" -lt 0 ]; then
    sha256sum <&3 || exit 44
elif [ ""$3"" -gt 0 ]; then
    dd bs=65536 iflag=skip_bytes,count_bytes,fullblock skip=""$2"" count=""$3"" status=none <&3 || exit 44
fi
[ ""$(file_version ""$fd"")"" = ""$version"" ] && [ ""$(file_version ""$1"")"" = ""$version"" ] || exit 46
if [ -n ""$5"" ]; then
    [ -e ""/proc/$5/fd/9"" ] || exit 47
    case ""$(ps -ww -p ""$5"" -o args=)"" in
        *"" swifttree-preview-watch $6"") ;;
        *) exit 47 ;;
    esac
    if [ ""$3"" -lt 0 ]; then kill -USR1 ""$5"" || exit 47
    else kill -USR2 ""$5"" || exit 47
    fi
fi
";

    private readonly SwiftTreeWindowsCoreBridge core;
    private readonly string machine;
    private readonly string path;
    private readonly SwiftTreePreviewText text = new SwiftTreePreviewText(RangeBytes);
    private readonly SHA256 checksum;
    private SwiftTreeLinuxPreviewConnection connection;
    private long position;
    private long length;

    public SwiftTreeLinuxPreviewFile(SwiftTreeWindowsCoreBridge core, string machine, string path, string expected, bool prefixOnly)
    {
        this.core = core;
        this.machine = machine;
        this.path = path;
        Version = expected;
        if (!prefixOnly) checksum = SHA256.Create();
    }

    public string Version { get; private set; }
    public bool AtEnd { get { return position == length; } }

    public string ReadRange(int limit)
    {
        if (checksum != null && connection == null)
        {
            connection = new SwiftTreeLinuxPreviewConnection(core, machine);
            connection.WaitUntilReady();
        }
        if (connection != null) connection.Check();
        var range = Read(core, machine, path, position, limit, Version, connection);
        if (connection != null) connection.Check();
        if (checksum != null) checksum.TransformBlock(range.Payload, range.Start, range.Count, range.Payload, range.Start);
        Version = range.Version;
        length = range.Length;
        position += range.Count;
        return text.Decode(range.Payload, range.Start, range.Count, AtEnd);
    }

    public void VerifyCompletion(string path)
    {
        connection.Check();
        var verified = Read(core, machine, path, 0, ChecksumRequest, Version, connection);
        connection.Complete();
        checksum.TransformFinalBlock(new byte[0], 0, 0);
        string readBytes = BitConverter.ToString(checksum.Hash).Replace("-", "").ToLowerInvariant();
        string currentFile = Encoding.ASCII.GetString(verified.Payload, verified.Start, verified.Count);
        if (currentFile != readBytes + "  -\n")
            throw new SwiftTreeLinuxPreviewException("The remote file changed. Reopen it to try again.");
    }

    public static void VerifyPath(SwiftTreeWindowsCoreBridge core, string machine, string path, string version)
    {
        Read(core, machine, path, 0, 0, version);
    }

    public void Dispose()
    {
        if (connection != null) connection.Dispose();
        if (checksum != null) checksum.Dispose();
    }

    private static Range Read(SwiftTreeWindowsCoreBridge core, string machine, string path,
                              long offset, int limit, string expected, SwiftTreeLinuxPreviewConnection connection = null)
    {
        if (String.IsNullOrEmpty(path) || path[0] != '/') throw new IOException("Invalid remote preview path.");
        var result = core.Execute(machine, new[] { "sh", "-c", ReadScript, "swifttree-preview",
            path, offset.ToString(CultureInfo.InvariantCulture), limit.ToString(CultureInfo.InvariantCulture),
            expected ?? "", connection == null ? "" : connection.Pid, connection == null ? "" : connection.Token }, RangeTimeout);
        if (result == null || result.code == null || result.timed_out || result.code == 47)
            throw new SwiftTreeLinuxPreviewException("SSH preview connection unavailable or timed out. Reopen the file to try again.");
        if (result.code == 46)
            throw new SwiftTreeLinuxPreviewException("The remote file changed. Reopen it to try again.");
        if (result.truncated || result.code != 0 || result.stdout == null)
            throw new SwiftTreeLinuxPreviewException("Could not read the remote file. Reopen it to try again.");

        var payload = Convert.FromBase64String(result.stdout);
        int newline = Array.IndexOf(payload, (byte)'\n', 0, Math.Min(payload.Length, 512));
        if (newline < 0) throw new InvalidDataException("Missing remote file version.");
        string version = Encoding.ASCII.GetString(payload, 0, newline);
        var fields = version.Split('|');
        long length;
        if (fields.Length != 5 || !Int64.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out length)
            || length < offset || (expected != null && expected != version)) throw new InvalidDataException("Invalid remote file version.");
        int count = payload.Length - newline - 1;
        long expectedCount = limit < 0 ? 68 : Math.Min(limit, length - offset);
        if (count != expectedCount) throw new InvalidDataException("Incomplete remote preview range.");
        return new Range { Version = version, Length = length, Payload = payload, Start = newline + 1, Count = count };
    }

    private sealed class Range
    {
        public string Version;
        public long Length;
        public byte[] Payload;
        public int Start, Count;
    }
}

internal sealed class SwiftTreeLinuxPreviewException : IOException
{
    public SwiftTreeLinuxPreviewException(string message) : base(message) { }
}
