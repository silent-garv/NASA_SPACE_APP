const net = require('net');
const s = net.createConnection({port:4000, host:'127.0.0.1'}, ()=>{
  console.log('connected to 127.0.0.1:4000');
  s.end();
});
s.on('error', e=>{
  console.error('port check error', e.message);
  process.exit(1);
});
