import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';


// load env variables
dotenv.config();

// create a mongodb to store the poll info
const client = new MongoClient(process.env.DB_CONN_STRING!);

// create a poll update function
export async function connect(dbName: string): Promise<Db> {
    await client.connect();
    console.log('connected to db');
    return client.db(dbName);
}

export async function disconnect(): Promise<void> {
    await client.close();
    console.log('disconnected from db');
}