import { proto, downloadMediaMessage } from '@whiskeysockets/baileys'
import { writeFile } from 'fs/promises'


export async function downloadMedia(message: proto.IWebMessageInfo) {
    try {
        const buffer = await downloadMediaMessage(message, 'buffer', {})
        const msgType = message.message?.audioMessage ? 'mp3' : message.message?.videoMessage ? 'mp4' : message.message?.imageMessage ? 'jpg' : message.message?.stickerMessage ? 'webp' : 'jpg'
        await writeFile(`data/media/${message.key.id}.${msgType} `, buffer)

    } catch (error) {
    }
}