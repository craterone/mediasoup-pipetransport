/* eslint-disable require-atomic-updates */
import { Device } from "mediasoup-client";

const localIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
const $setup = document.getElementById('setup');
const $produce = document.getElementById('produce');
const $pid = document.getElementById('produce-id');

const state = {
  device: null,
  sendTransport: null,
  producer: null
};

const request = (path, query) => {
  const qs = query ? "?q=" + encodeURIComponent(JSON.stringify(query)) : "";
  return fetch(`http://${localIp}:3000/${path}${qs}`).then(res => res.json());
};

$setup.onclick = async () => {
  const routerRtpCapabilities = await request("rtpCapabilities");
  await request("reportPipeAddress");

  const device = new Device();
  await device.load({ routerRtpCapabilities });

  if (!device.canProduce("video")) throw new Error("Can not produce!");

  state.device = device;
  console.log("setup done");
};

$produce.onclick = async () => {
  const { id, iceParameters, iceCandidates, dtlsParameters } = await request(
    "createWebRtcTransport"
  );

  if (state.sendTransport === null) {
    const sendTransport = state.device.createSendTransport({
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters
    });

    sendTransport.once("connect", ({ dtlsParameters }, callback, errback) =>
      request("transportConnect", {
        transportId: sendTransport.id,
        dtlsParameters
      })
        .then(callback)
        .catch(errback)
    );

    sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) =>
      request("produce", { transportId: sendTransport.id, kind, rtpParameters })
        .then(callback)
        .catch(errback)
    );

    state.sendTransport = sendTransport;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  const [track] = stream.getVideoTracks();
  const producer = await state.sendTransport.produce({ track });

  state.producer = producer;

  console.log("produce done");
  console.log(producer.id);
  $pid.value = producer.id;

  const $video = document.createElement("video");
  $video.controls = $video.muted = true;
  $video.srcObject = new MediaStream([producer.track]);
  document.body.append($video);
  $video.play();
};
