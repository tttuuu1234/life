// HTTPSサーバーを2つ立てる。どちらも中身は同じで、使っている証明書だけが違う。
//   :8443 自己署名証明書（誰も保証していない）
//   :8444 自作CAが発行した証明書（Lab Root CA が保証している）
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const certs = path.join(__dirname, 'certs');
if (!fs.existsSync(path.join(certs, 'server.crt'))) {
  console.error('先に bash make-certs.sh を実行して証明書を作ってください');
  process.exit(1);
}
const read = (f) => fs.readFileSync(path.join(certs, f));

function start(port, label, key, cert) {
  https.createServer({ key: read(key), cert: read(cert) }, (req, res) => {
    // ここに届いた時点で、TLSのトンネルはもう出来上がっていて、中身は復号済み
    console.log(`[${label}] ${req.method} ${req.url}  ← 暗号化されて届き、サーバーで復号した`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width">
<body style="font-family:sans-serif;max-width:640px;margin:2em auto;padding:0 16px">
<h1>HTTPSでつながりました（${label}）</h1>
<p>証明書: <code>${cert}</code></p>
<p>アドレスバーの鍵アイコン（または「保護されていない通信」）を押すと、この証明書の中身を見られます。</p>
</body>`);
  }).listen(port, () => console.log(`[${label}] https://localhost:${port} で起動`));
}

start(8443, '自己署名', 'self-signed.key', 'self-signed.crt');
start(8444, '自作CA発行', 'server.key', 'server.crt');
