import { Boom } from '@hapi/boom'
import makeWASocket, {
    WAMessageKey, Browsers,
    DisconnectReason,
    getAggregateVotesInPollMessage,
    proto, WAMessageContent,
    useMultiFileAuthState,
    makeInMemoryStore, processHistoryMessage,
    downloadAndProcessHistorySyncNotification,
    makeCacheableSignalKeyStore,
    getHistoryMsg,
} from '@whiskeysockets/baileys'
import MAIN_LOGGER from '@whiskeysockets/baileys/lib/Utils/logger'
import NodeCache from 'node-cache'
import dotenv from 'dotenv';
import { decryptVote } from './utils/poll/decrypt';
import { downloadMedia } from './utils/media/downloadMedia';
import { updatePoll } from './utils/poll/update';
import { connect } from './utils/db/db';
import { PollRepository } from './utils/db/repository';


console.clear();

// group ids
const groups_ids = process.env.GROUP_JIDS!.split(',');

// create a logger
const logger = MAIN_LOGGER.child({});
logger.level = "debug";

// load env variables
dotenv.config();

// create a message retry cache
const msgRetryCounterCache = new NodeCache()

// create a store
const useStore = !process.argv.includes('--no-store')
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('data/auth_info_baileys/auth_info.json')
setInterval(() => store?.writeToFile('data/auth_info_baileys/auth_info.json'), 10_000)

// create a socket
const startSock = async () => {
    // connect to the db
    const db = await connect('polls');
    const pollRepository = new PollRepository(db);

    const { state, saveCreds } = await useMultiFileAuthState('data/auth_info_baileys/auth_info');

    // create a socket connection
    const sock = makeWASocket({
        printQRInTerminal: true,
        // browser: Browsers.macOS("Desktop"),
        syncFullHistory: true,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        logger,
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        getMessage
    });

    // connect to the socket
    store?.bind(sock.ev);

    // listen for messages            
    sock.ev.process(async (events) => {
        // console.log('events', events);
        // update the state
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                if ((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
                    startSock();
                } else {
                    console.log('logged out');
                }
            }
        }

        // update the state
        if (events['creds.update']) {
            console.log('creds updated');
            await saveCreds();

            if (events['creds.update'].processedHistoryMessages) {
                console.log('history messages processed', events['creds.update'].processedHistoryMessages);
            }
        }

        // update the state
        if (events['messages.upsert']) {
            const { messages } = events['messages.upsert'];
            console.log(`message received from ${messages[0].pushName}`);

            if (groups_ids.includes(messages[0]?.key?.remoteJid!)) {
                // get protocol message
                const protocolMessage = messages[0].message?.protocolMessage;

                if (protocolMessage) {
                    console.log('protocol message received');
                    // process the history message
                    const historyData = await downloadAndProcessHistorySyncNotification(protocolMessage.historySyncNotification!, {})

                    sock.ev.emit('messaging-history.set', { ...historyData, isLatest: true}) 
                }

                // download the media
                if (messages[0].message?.audioMessage || messages[0].message?.videoMessage || messages[0].message?.imageMessage || messages[0].message?.stickerMessage) {
                    await downloadMedia(messages[0])
                }

                // get poll info from the message
                if (messages[0].message?.pollUpdateMessage) {
                    // get poll info
                    const meId = sock.user?.id;
                    const pollMsg = messages[0].message?.pollUpdateMessage;
                    const creationMsgKey = pollMsg.pollCreationMessageKey!;
                    const pollCreationMsg = await getMessage(creationMsgKey);

                    // decrypt poll
                    try {
                        await decryptVote(
                            pollMsg,
                            pollCreationMsg!,
                            messages[0],
                            sock.ev,
                            meId!
                        );

                    } catch (error) {
                        console.log('error', error);
                    }
                }
            }
        }

        // message history received
        if (events['messaging-history.set']) {
            const { messages, chats } = events['messaging-history.set'];
            console.log('history received');

            for (const message of messages) {
                if (groups_ids.includes(message.key.remoteJid!) ) {
                    if (message.message?.audioMessage || message.message?.videoMessage || message.message?.imageMessage || message.message?.stickerMessage) {
                        await downloadMedia(message)
                    } else if (message.message?.pollUpdateMessage) {
                        // get poll info
                        const meId = sock.user?.id;
                        const pollMsg = message.message?.pollUpdateMessage!;
                        const creationMsgKey = pollMsg.pollCreationMessageKey!;
                        const pollCreationMsg = await getMessage(creationMsgKey);

                        // decrypt poll
                        try {
                            await decryptVote(
                                pollMsg!,
                                pollCreationMsg!,
                                message,
                                sock.ev,
                                meId!
                            );

                        } catch (error) {
                            console.log('error', error);
                        }
                    }
                };
            }
        }

        // get message update events
        if (events['messages.update']) {
            console.log('message updated');
            for (const { key, update } of events['messages.update']) {
                if (update.pollUpdates) {
                    // get poll info from the update and aggregate the votes
                    const pollCreationMsg = await getMessage(key);
                    if (pollCreationMsg) {
                        const pollVotes = getAggregateVotesInPollMessage({
                            message: pollCreationMsg,
                            pollUpdates: update.pollUpdates
                        })

                        // get the poll update message 
                        const pollUpdateMsg = await getMessage(update?.pollUpdates[0].pollUpdateMessageKey!);

                        // get the poll options and store them in the poll json
                        const remoteJid = pollUpdateMsg?.pollUpdateMessage?.pollCreationMessageKey?.remoteJid!;
                        const pollId = pollUpdateMsg?.pollUpdateMessage?.pollCreationMessageKey?.id!;
                        const question = pollCreationMsg?.pollCreationMessage?.name!;
                        const voterName = update.pushName!;

                        // update the poll info in the db
                        await updatePoll(
                            pollRepository,
                            pollId,
                            question,
                            pollVotes,
                        );
                    }
                }
            }
        }
    });

    sock.ev.on('messaging-history.set', async (history) => {
        const messages = history.messages;
        console.log('history received');

        for (const message of messages) {
            if (groups_ids.includes(message.key.remoteJid!)) {
                console.log(message)
                if (message.message?.audioMessage || message.message?.videoMessage || message.message?.imageMessage || message.message?.stickerMessage) {
                    await downloadMedia(message)

                } else if (message.message?.pollUpdateMessage) {
                    console.log(message)
                    // get poll info
                    const meId = sock.user?.id;
                    const pollMsg = message.message?.pollUpdateMessage!;
                    const creationMsgKey = pollMsg.pollCreationMessageKey!; 
                    const pollCreationMsg = await getMessage(creationMsgKey); // Await the getMessage function call

                    // decrypt poll
                    try {
                        await decryptVote(
                            pollMsg!,
                            pollCreationMsg!,
                            message,
                            sock.ev,
                            meId!
                        );

                    } catch (error) {
                        console.log('error', error);
                    }
                }
            }
        }
    });

    return sock;

    // get message from store on request
    async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
        if (store) {
            const msg = await store.loadMessage(key.remoteJid!, key.id!);
            return msg?.message || undefined;
        }

        return proto.Message.fromObject({})

    }
};

startSock();