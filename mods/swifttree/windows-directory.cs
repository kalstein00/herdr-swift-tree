using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class SwiftTreeWindowsDirectory
{
    private const int NumericCollation = 7;
    private const int On = 17;
    private const uint OpenExisting = 3;
    private const uint OpenDirectory = 0x02000000;
    private const int FileIdInformation = 18;

    [StructLayout(LayoutKind.Sequential)]
    private struct FileIdInfo
    {
        internal ulong Volume;
        internal ulong FileIdLow;
        internal ulong FileIdHigh;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, FileShare share, IntPtr security,
                                             uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass,
                                                            out FileIdInfo info, int size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, int size, uint flags);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern IntPtr ucol_open(string locale, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern void ucol_setAttribute(IntPtr collator, int attribute, int value, ref int status);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int ucol_strcoll(IntPtr collator, string left, int leftLength, string right, int rightLength);

    [DllImport("icu.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern void ucol_close(IntPtr collator);

    private class Entry
    {
        public string name { get; private set; }
        public bool directory { get; private set; }

        public Entry(string name, bool directory)
        {
            this.name = name;
            this.directory = directory;
        }
    }

    private sealed class DirectoryLink : Entry
    {
        public bool link { get { return true; } }

        public DirectoryLink(string name) : base(name, true) { }
    }

    private sealed class UnresolvedLink : Entry
    {
        public bool link { get { return true; } }
        public bool targetUnknown { get { return true; } }

        public UnresolvedLink(string name) : base(name, false) { }
    }

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    internal static string Serialize(object value)
    {
        lock (Json) return Json.Serialize(value);
    }

    internal static T Deserialize<T>(string value)
    {
        lock (Json) return Json.Deserialize<T>(value);
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length < 2) return 2;
        if (args[0] == "watch-worker" && (args.Length == 3 || args.Length == 4))
            return SwiftTreeWindowsWatcher.Run(Decode(args[1]), Decode(args[2]),
                                              args.Length == 4 ? Decode(args[3]) : null);
        if (args[0] == "directory-worker" && args.Length == 3)
            return SwiftTreeWindowsDirectoryServer.Run(Decode(args[1]), Decode(args[2]));

        try
        {
            object listing;
            switch (args[0])
            {
                case "list":
                    listing = ReadLocalListing(args[1], args.Length >= 3 ? args[2] : "open",
                                               args.Length >= 4 ? args[3] : "");
                    break;
                case "sort-linux":
                    listing = DecodeLinuxListing(File.ReadAllText(args[1]));
                    break;
                case "git-search-scope":
                    if (args.Length != 3) return 2;
                    return WriteGitSearchScope(args[1], args[2]);
                case "start-watch":
                    if (args.Length != 3 && args.Length != 4) return 2;
                    return LaunchWorker("watch-worker", args[1], args[args.Length - 1],
                                        args.Length == 4 ? args[2] : null);
                case "start-directory":
                    if (args.Length != 3) return 2;
                    return LaunchWorker("directory-worker", args[1], args[2]);
                case "start-preview":
                    if (args.Length != 2) return 2;
                    return SwiftTreePreviewLauncher.Connect(args[1]);
                case "warm-preview":
                    if (args.Length != 2) return 2;
                    return SwiftTreePreviewLauncher.WarmUp(args[1]);
                case "stop-preview":
                    if (args.Length != 2) return 2;
                    return SwiftTreePreviewLauncher.StopInstalled(args[1]);
                default:
                    return 2;
            }

            Console.WriteLine(Serialize(listing));
        }
        catch (UnauthorizedAccessException) { WriteStatus("denied"); }
        catch (DirectoryNotFoundException) { WriteStatus("missing"); }
        catch (FileNotFoundException) { WriteStatus("missing"); }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            if (args[0] == "start-preview" || args[0] == "warm-preview" || args[0] == "stop-preview" ||
                args[0] == "git-search-scope") return 1;
            WriteStatus("failed");
        }
        return 0;
    }

    private static Process StartGit(string executable, string folder, string arguments)
    {
        var start = new ProcessStartInfo(executable, arguments)
        {
            WorkingDirectory = folder,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.EnvironmentVariables["LC_ALL"] = "C";
        return Process.Start(start);
    }

    private static int WriteGitSearchScope(string folder, string output)
    {
        ReclaimGitSearchScratch(Path.GetDirectoryName(output));
        var git = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator)
            .Select(directory => directory.Trim().Trim('"'))
            .Where(Path.IsPathRooted)
            .Select(directory => Path.Combine(directory, "git.exe"))
            .FirstOrDefault(File.Exists);
        if (git == null) return 44;

        using (var probe = StartGit(git, folder, "rev-parse --is-inside-work-tree"))
        {
            var error = probe.StandardError.ReadToEndAsync();
            var result = probe.StandardOutput.ReadToEnd();
            probe.WaitForExit();
            if (probe.ExitCode != 0)
                return error.Result.Contains("not a git repository") ? 44 : 1;
            if (result.Trim() != "true") return 44;
        }
        bool ignoreCase;
        using (var config = StartGit(git, folder, "config --bool --get core.ignorecase"))
        {
            var error = config.StandardError.ReadToEndAsync();
            var value = config.StandardOutput.ReadToEnd();
            config.WaitForExit();
            if (config.ExitCode > 1) { Console.Error.WriteLine(error.Result); return 1; }
            ignoreCase = value.Trim() == "true";
        }
        using (var list = StartGit(git, folder, "ls-files -z --cached --others --exclude-standard"))
        {
            var error = list.StandardError.ReadToEndAsync();
            int chunks = WriteGitChunks(list.StandardOutput.BaseStream, output);
            list.WaitForExit();
            if (list.ExitCode != 0) Console.Error.WriteLine(error.Result);
            else Console.WriteLine(Serialize(new { chunks = chunks, ignoreCase = ignoreCase }));
            return list.ExitCode == 0 ? 0 : 1;
        }
    }

    private static void ReclaimGitSearchScratch(string home)
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-10);
        foreach (var directory in new DirectoryInfo(home).EnumerateDirectories(".swifttree-search-*"))
        {
            try
            {
                if (!Regex.IsMatch(directory.Name, @"^\.swifttree-search-[0-9]{13}-[a-z0-9]+$") ||
                    directory.LastWriteTimeUtc >= cutoff ||
                    (directory.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                foreach (var file in directory.EnumerateFiles())
                {
                    int chunk;
                    if (Int32.TryParse(file.Name, NumberStyles.None, CultureInfo.InvariantCulture, out chunk))
                        file.Delete();
                }
                directory.Delete();
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static int WriteGitChunks(Stream source, string output)
    {
        var buffer = new byte[64 * 1024];
        int chunks = 0;
        FileStream destination = null;
        try
        {
            int count;
            while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                int split = count;
                bool rotate = false;
                if (destination != null && destination.Length + count >= 1024 * 1024)
                {
                    int boundary = Array.LastIndexOf(buffer, (byte)0, count - 1, count);
                    if (boundary >= 0) { split = boundary + 1; rotate = true; }
                }
                if (destination == null)
                    destination = CreateGitChunk(output, chunks++);
                destination.Write(buffer, 0, split);
                if (!rotate) continue;
                destination.Dispose();
                destination = null;
                if (split < count)
                {
                    destination = CreateGitChunk(output, chunks++);
                    destination.Write(buffer, split, count - split);
                }
            }
        }
        finally { if (destination != null) destination.Dispose(); }
        return chunks;
    }

    private static FileStream CreateGitChunk(string directory, int index)
    {
        return new FileStream(Path.Combine(directory, index.ToString(CultureInfo.InvariantCulture)),
                              FileMode.CreateNew, FileAccess.Write);
    }

    private static void WriteStatus(string status)
    {
        Console.WriteLine(Serialize(new { status = status }));
    }

    private static int LaunchWorker(string mode, string argument, string endpoint, string ancestors = null)
    {
        var start = new ProcessStartInfo
        {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = mode + " " + Encode(argument) + " " + Encode(endpoint)
                + (ancestors == null ? "" : " " + Encode(ancestors)),
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        using (Process.Start(start)) { }
        return 0;
    }

    private static string Encode(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
    }

    private static string Decode(string value)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(value));
    }

    private static SafeFileHandle OpenFolder(string folder)
    {
        var handle = CreateFileW(folder, 0, FileShare.Read | FileShare.Write | FileShare.Delete, IntPtr.Zero,
                                 OpenExisting, OpenDirectory, IntPtr.Zero);
        if (!handle.IsInvalid) return handle;
        var error = Marshal.GetLastWin32Error();
        handle.Dispose();
        if (error == 5) throw new UnauthorizedAccessException();
        if (error == 2 || error == 3 || error == 267) throw new DirectoryNotFoundException();
        throw new Win32Exception(error);
    }

    private static string Identity(SafeFileHandle folder)
    {
        FileIdInfo info;
        if (!GetFileInformationByHandleEx(folder, FileIdInformation, out info, Marshal.SizeOf(typeof(FileIdInfo))))
            throw new Win32Exception();
        return String.Format(CultureInfo.InvariantCulture, "{0:x16}:{1:x16}{2:x16}",
                             info.Volume, info.FileIdHigh, info.FileIdLow);
    }

    internal static string TryReadDirectoryIdentity(string folder)
    {
        try
        {
            using (var opened = OpenFolder(folder)) return Identity(opened);
        }
        catch (UnauthorizedAccessException) { return null; }
        catch (IOException) { return null; }
        catch (Win32Exception) { return null; }
    }

    private static string ResolvedPath(SafeFileHandle folder)
    {
        const uint normalizedDosPath = 0;
        const string extendedPath = @"\\?\";
        const string extendedUnc = @"\\?\UNC\";
        var path = new StringBuilder(512);
        for (;;)
        {
            uint length = GetFinalPathNameByHandleW(folder, path, path.Capacity, normalizedDosPath);
            if (length == 0) throw new Win32Exception();
            if (length < path.Capacity) break;
            path.Capacity = checked((int)length + 1);
        }
        var resolved = path.ToString();
        // The .NET Framework DirectoryInfo reader takes regular DOS/UNC paths.
        if (resolved.StartsWith(extendedUnc, StringComparison.OrdinalIgnoreCase))
            return @"\\" + resolved.Substring(extendedUnc.Length);
        return resolved.StartsWith(extendedPath, StringComparison.Ordinal)
            ? resolved.Substring(extendedPath.Length) : resolved;
    }

    internal static object ReadLocalListing(string folder, string reason, string ancestors)
    {
        using (var opened = OpenFolder(folder))
        {
            var identity = Identity(opened);
            if ((ancestors ?? "").Split(',').Contains(identity)) return new { status = "cycle" };

            // Read the resolved directory so a retargeted link cannot redirect
            // the enumeration after the ancestry check.
            var target = ResolvedPath(opened);
            Trace("list", folder, reason);
            var entries = new DirectoryInfo(target).GetFileSystemInfos().Select(entry =>
                entry is DirectoryInfo && (entry.Attributes & FileAttributes.ReparsePoint) != 0
                    ? new DirectoryLink(entry.Name) : new Entry(entry.Name, entry is DirectoryInfo)).ToArray();
            var sorted = Sort(entries);
            using (var current = OpenFolder(folder))
            {
                if (Identity(current) != identity)
                    throw new IOException("The folder changed while it was read.");
            }
            return new { status = "ready", identity = identity, entries = sorted };
        }
    }

    internal static object DecodeLinuxListing(string listing)
    {
        var bytes = Convert.FromBase64String(listing);
        var records = new UTF8Encoding(false, true).GetString(bytes).Split('\0');
        if (records.Length < 3 || records[records.Length - 2] != "" || records[records.Length - 1] != "")
            throw new FormatException("Incomplete directory listing.");
        var identity = records[0];
        if (!System.Text.RegularExpressions.Regex.IsMatch(identity, @"\A[0-9]+:[0-9]+\z"))
            throw new FormatException("Invalid directory identity.");

        var entries = new Entry[records.Length - 3];
        for (int index = 0; index < entries.Length; index++)
        {
            var record = records[index + 1];
            if (record.Length < 3) throw new FormatException("Invalid directory entry.");
            var name = record.Substring(2);
            if (record[0] == 'l' && record[1] == 'd')
                entries[index] = new DirectoryLink(name);
            else if (record[0] == 'l' && "N?L".IndexOf(record[1]) >= 0)
                entries[index] = new UnresolvedLink(name);
            else
                entries[index] = new Entry(name, record[0] == 'd');
        }
        return new { status = "ready", identity = identity, entries = Sort(entries) };
    }

    private static Entry[] Sort(Entry[] entries)
    {
        if (entries.Length < 2) return entries;
        int status = 0;
        var locale = CultureInfo.CurrentCulture.Name;
        var collator = ucol_open(locale, ref status);
        if (collator == IntPtr.Zero) throw new InvalidOperationException("Could not open the Windows collator.");

        try
        {
            if (status > 0) throw new InvalidOperationException("Could not open the Windows collator.");
            ucol_setAttribute(collator, NumericCollation, On, ref status);
            if (status > 0) throw new InvalidOperationException("Could not enable numeric file ordering.");

            var compareNames = Comparer<string>.Create((left, right) =>
            {
                int order = ucol_strcoll(collator, left, left.Length, right, right.Length);
                return order != 0 ? order : left.Length.CompareTo(right.Length);
            });
            return entries.OrderBy(entry => !entry.directory)
                          .ThenBy(entry => entry.name, compareNames)
                          .ToArray();
        }
        finally
        {
            ucol_close(collator);
        }
    }

    internal static void Trace(string operation, string folder, string reason)
    {
        var destination = Environment.GetEnvironmentVariable("SWIFTTREE_WINDOWS_TRACE");
        if (!Directory.Exists(destination)) return;

        var record = new { operation = operation, folder = folder, reason = reason, pid = Process.GetCurrentProcess().Id,
            timestamp = Stopwatch.GetTimestamp(), frequency = Stopwatch.Frequency };
        try
        {
            var path = Path.Combine(destination, Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(path, Serialize(record), new UTF8Encoding(false));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
