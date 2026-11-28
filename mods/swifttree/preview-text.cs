using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal interface ISwiftTreePreviewFile : IDisposable
{
    string Version { get; }
    bool AtEnd { get; }
    string ReadRange(int limit);
    void VerifyCompletion(string path);
}

internal sealed class SwiftTreePreviewText
{
    public const int PrefixBytes = 64 * 1024;
    public const int RangeBytes = 256 * 1024;

    private readonly Decoder decoder = new UTF8Encoding(false, true).GetDecoder();
    private readonly char[] characters;
    private bool atStart = true;

    public SwiftTreePreviewText(int rangeBytes = RangeBytes) { characters = new char[rangeBytes + 2]; }

    public string Decode(byte[] bytes, int offset, int count, bool last)
    {
        int decoded = decoder.GetChars(bytes, offset, count, characters, 0, last);
        if (Array.IndexOf(characters, '\0', 0, decoded) >= 0)
            throw new InvalidDataException("File contains a NUL character.");
        int start = atStart && decoded > 0 && characters[0] == '\uFEFF' ? 1 : 0;
        atStart = false;
        return new string(characters, start, decoded - start);
    }

    public static string Fingerprint(string prefix)
    {
        using (var sha = SHA256.Create())
            return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(prefix)));
    }
}
