export async function startWebcamPreview(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
}

export function stopWebcamPreview(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null
  stream?.getTracks().forEach((t) => t.stop())
  video.srcObject = null
}
