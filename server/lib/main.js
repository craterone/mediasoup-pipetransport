const http = require("http");
const mediasoup = require("mediasoup");
const fetch = require("node-fetch")

const port = process.env.PORT || 3000;
const mediaCodecs = [
  {
    kind: "video",
    name: "VP9",
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: {}
  }
];
const listenIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
const remoteIp = process.env.MEDIASOUP_REMOTE_IP || "127.0.0.1";
let room = {};

const request = (path, query) => {
  const qs = query ? "?q=" + encodeURIComponent(JSON.stringify(query)) : "";
  return fetch(`http://${remoteIp}:3000/${path}${qs}`).then(res => res.json());
};

(async function() {
  room.worker = await mediasoup.createWorker();
  room.router = await room.worker.createRouter({ mediaCodecs });
  room.pipeTransport = await room.router.createPipeTransport({ listenIp });
  console.log('local tuple', room.pipeTransport.tuple.localIp, ':', room.pipeTransport.tuple.localPort);

  http
    .createServer(async (req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });

      const [url, qs] = req.url.split("?q=");
      const query = qs ? JSON.parse(decodeURIComponent(qs)) : {};

      console.log(`[req]: ${url}`);
      switch (url) {
        case "/rtpCapabilities": {
          res.end(JSON.stringify(room.router.rtpCapabilities));
          break;
        }
        case "/notifyPipeConnect": {
          const { ip, port } = query;
          room.remoteIp = ip;
          room.remotePort = port;
          await room.pipeTransport.connect({"ip": room.remoteIp, "port": room.remotePort});
          console.log('Pipe connect to remote IP:', room.remoteIp, 'remote port:', room.remotePort);
          res.end(JSON.stringify({}));
          break;
        }
        case "/reportPipeAddress": {
          await request(
            "notifyPipeConnect",
            {
              ip: room.pipeTransport.tuple.localIp,
              port: room.pipeTransport.tuple.localPort
            }
          );
          res.end(JSON.stringify({
            ip: room.pipeTransport.tuple.localIp,
            port: room.pipeTransport.tuple.localPort
          }));
          break;
        }
        case "/createWebRtcTransport": {
          room.webrtcTransport = await room.router.createWebRtcTransport({ listenIps: [listenIp] });

          res.end(
            JSON.stringify({
              id: room.webrtcTransport.id,
              iceParameters: room.webrtcTransport.iceParameters,
              iceCandidates: room.webrtcTransport.iceCandidates,
              dtlsParameters: room.webrtcTransport.dtlsParameters
            })
          );
          break;
        }
        case "/transportConnect": {
          const { transportId, dtlsParameters } = query;
          await room.webrtcTransport.connect({ dtlsParameters });

          res.end(JSON.stringify({}));
          break;
        }
        case "/reportRtpParameters": {
          const { produceId, kind, rtpParameters } = query;
          room.remoteKind = kind;
          room.remoteRtpParameters = rtpParameters;
          room.remoteProduceId = produceId;

          res.end(JSON.stringify({}));
          break;
        }
        case "/produce": {
          const { kind, rtpParameters } = query;

          room.webrtcProducer = await room.webrtcTransport.produce({ kind, rtpParameters });
          room.pipeConsumer = await room.pipeTransport.consume({"producerId": room.webrtcProducer.id});
          await request(
            "reportRtpParameters",
            {
              produceId: room.webrtcProducer.id,
              kind: room.pipeConsumer.kind,
              rtpParameters: room.pipeConsumer.rtpParameters
            }
          );

          res.end(JSON.stringify({ id: room.webrtcProducer.id }));
          break;
        }
        case "/consume": {
          const { rtpCapabilities } = query;
          room.pipeProducer = await room.pipeTransport.produce({
            id: room.remoteProduceId,
            kind: room.remoteKind,
            rtpParameters: room.remoteRtpParameters
          });
          room.webrtcConsumer = await room.webrtcTransport.consume({
            producerId: room.remoteProduceId,
            rtpCapabilities
          });

          res.end(
            JSON.stringify({
              id: room.webrtcConsumer.id,
              producerId: room.remoteProduceId,
              kind: room.webrtcConsumer.kind,
              rtpParameters: room.webrtcConsumer.rtpParameters
            })
          );
          break;
        }
        default:
          console.error("N/A route", url);
      }
    })
    .listen(port);

  console.log("server started at port", port);
})();
