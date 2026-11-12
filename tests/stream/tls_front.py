"""Test helper: accepts RTMPS (TLS) on one port and passes the plain RTMP inside to another port, like a platform's front end."""
import socket, ssl, sys, threading
port, target, cert, key = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(('127.0.0.1', port)); srv.listen(1)
srv.settimeout(20)
conn, _ = srv.accept()
tls = ctx.wrap_socket(conn, server_side=True)
up = socket.create_connection(('127.0.0.1', target))
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except Exception: pass
    for s in (a, b):
        try: s.close()
        except Exception: pass
threading.Thread(target=pipe, args=(tls, up), daemon=True).start()
pipe(up, tls)
