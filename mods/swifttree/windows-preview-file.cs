using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal sealed class SwiftTreePreviewFile : ISwiftTreePreviewFile
{
    private const uint LockFailImmediately = 1;

    private readonly FileStream stream;
    private readonly long length;
    private readonly long lockedBytes;
    private readonly SwiftTreePreviewText text = new SwiftTreePreviewText();
    private readonly byte[] bytes = new byte[SwiftTreePreviewText.RangeBytes];

    public SwiftTreePreviewFile(string path, long maximumLockedBytes = Int64.MaxValue)
    {
        stream = OpenRead(path);
        try
        {
            length = stream.Length;
            string before = GetVersion(stream.SafeFileHandle);
            long requestedLock = Math.Min(length, maximumLockedBytes);
            var range = new Overlapped();
            // Keep the bytes being read stable while allowing existing log handles and appends.
            if (requestedLock > 0 && !LockFileEx(stream.SafeFileHandle, LockFailImmediately, 0,
                    (uint)requestedLock, (uint)(requestedLock >> 32), ref range)) throw new Win32Exception();
            lockedBytes = requestedLock;
            Version = GetVersion(stream.SafeFileHandle);
            if (Version != before || stream.Length != length) throw new IOException("Preview file changed.");
        }
        catch { Dispose(); throw; }
    }

    public string Version { get; private set; }
    public bool AtEnd { get { return stream.Position == length; } }

    public string ReadRange(int limit)
    {
        int count = 0;
        int expected = (int)Math.Min(limit, length - stream.Position);
        while (count < expected)
        {
            int read = stream.Read(bytes, count, expected - count);
            if (read == 0) throw new EndOfStreamException("Preview file changed.");
            count += read;
        }

        return text.Decode(bytes, 0, count, AtEnd);
    }

    public void VerifyCompletion(string path)
    {
        VerifyPath(path, Version);
    }

    public static void VerifyPath(string path, string version)
    {
        using (var current = OpenRead(path))
            if (GetVersion(current.SafeFileHandle) != version) throw new IOException("Preview file changed.");
    }

    private static FileStream OpenRead(string path)
    {
        return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete,
                              4096, FileOptions.SequentialScan);
    }

    public void Dispose()
    {
        try
        {
            if (lockedBytes > 0)
            {
                var range = new Overlapped();
                UnlockFileEx(stream.SafeFileHandle, 0, (uint)lockedBytes, (uint)(lockedBytes >> 32), ref range);
            }
        }
        finally { stream.Dispose(); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Overlapped
    {
        public IntPtr Internal, InternalHigh;
        public uint Offset, OffsetHigh;
        public IntPtr Event;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool LockFileEx(SafeFileHandle file, uint flags, uint reserved, uint lengthLow,
                                          uint lengthHigh, ref Overlapped range);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UnlockFileEx(SafeFileHandle file, uint reserved, uint lengthLow, uint lengthHigh,
                                            ref Overlapped range);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);

    private static string GetVersion(SafeFileHandle file)
    {
        FileInformation info;
        if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception();
        return String.Format(CultureInfo.InvariantCulture, "{0:x8}:{1:x8}{2:x8}:{3:x8}{4:x8}:{5:x8}{6:x8}",
                             info.Volume, info.IndexHigh, info.IndexLow, info.WriteHigh, info.WriteLow,
                             info.SizeHigh, info.SizeLow);
    }
}
