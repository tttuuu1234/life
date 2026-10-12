// 3つのサーバーをまとめて起動する。 node start.js
// ターミナルのログには [認可サーバー] [リソースサーバー] [クライアント] の印が付くので、
// ブラウザで操作しながら、どのサーバーが何をしたかを追える。

require('./auth-server').start();
require('./resource-server').start();
require('./client').start();
