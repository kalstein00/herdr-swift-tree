using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class SwiftTreeWindowsLocalService
{
    public static string Json(object value)
    {
        return new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Serialize(value);
    }

    public static T ReadJson<T>(string value)
    {
        return new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Deserialize<T>(value);
    }

    public static int Run(string endpoint, Action ready, Action<TcpClient, NetworkStream> serve)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        try
        {
            listener.Start(1);
            var password = NewPassword();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            File.WriteAllText(endpoint + ".tmp",
                Json(new { port = port, token = password }));
            File.Move(endpoint + ".tmp", endpoint);
            if (ready != null) ready();

            var deadline = Stopwatch.StartNew();
            while (!listener.Pending())
            {
                if (deadline.ElapsedMilliseconds >= 5000) return 2;
                Thread.Sleep(20);
            }
            using (var client = listener.AcceptTcpClient())
            {
                client.ReceiveTimeout = 2000;
                client.SendTimeout = 2000;
                client.NoDelay = true;
                listener.Stop();
                var stream = client.GetStream();
                if (!Authenticate(stream, password)) return 2;
                client.ReceiveTimeout = 0;
                serve(client, stream);
            }
            return 0;
        }
        catch (IOException) { return 1; }
        catch (UnauthorizedAccessException) { return 1; }
        catch (ArgumentException) { return 1; }
        catch (SocketException) { return 1; }
        finally
        {
            listener.Stop();
        }
    }

    public static string NewPassword()
    {
        var token = new byte[16];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(token);
        return Convert.ToBase64String(token);
    }

    public static bool Authenticate(NetworkStream stream, string password)
    {
        var received = new byte[password.Length];
        int offset = 0;
        while (offset < received.Length)
        {
            int count = stream.Read(received, offset, received.Length - offset);
            if (count == 0) return false;
            offset += count;
        }
        return Encoding.ASCII.GetString(received) == password;
    }

    public static byte[] WireMessage(object value)
    {
        var json = Json(value);
        var ascii = new StringBuilder(json.Length + 1);
        foreach (char character in json)
        {
            if (character < 128) ascii.Append(character);
            else ascii.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
        }
        return Encoding.ASCII.GetBytes(ascii.Append('\n').ToString());
    }
}
