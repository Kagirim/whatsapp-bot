import { proto, decryptPollVote, jidNormalizedUser, getKeyAuthor, BaileysEventEmitter } from '@whiskeysockets/baileys'


export async function decryptVote( pollMsg: proto.Message.IPollUpdateMessage, pollCreationMsg: proto.IMessage, message: proto.IWebMessageInfo, ev: BaileysEventEmitter, meId: string) {
    // get poll info
    const pollMsgId = pollMsg.pollCreationMessageKey?.id!;
    const creationMsgKey = pollMsg.pollCreationMessageKey!;
    const pollEncKey = pollCreationMsg?.messageContextInfo?.messageSecret!;
    const voterJid = getKeyAuthor(message.key, jidNormalizedUser(meId));
    const pollCreatorJid = getKeyAuthor(pollMsg.pollCreationMessageKey!, jidNormalizedUser(meId));
    const msgTimestamp = message.messageTimestamp!;
    const updateMsgKey = message.key!;
    const vote = pollMsg.vote!;     

    const decryptedVote = decryptPollVote(
        vote!,
        {
            pollEncKey,
            pollCreatorJid,
            pollMsgId,
            voterJid
        }
    )

    // emit a message update for the poll
    ev.emit('messages.update', [
        {
            key: creationMsgKey,
            update: {
                pollUpdates: [
                    {
                        pollUpdateMessageKey: updateMsgKey,
                        vote: decryptedVote,
                        senderTimestampMs: msgTimestamp,
                    }
                ]
            }
        }
    ])
}
