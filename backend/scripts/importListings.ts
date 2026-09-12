import { parseListing } from "../src/gmail/listings.ts"
import { parseMessage } from "../src/gmail/message.ts";
import { RAW_DIR } from "../src/gmail/mailbox.ts";
import { client, db } from "../src/db/index.ts";
import { listings } from "../src/db/schema.ts";
import {sql} from 'drizzle-orm';

import * as fs from 'node:fs'
import * as path from 'node:path';
import {readFile} from 'node:fs/promises';

const files = fs.readdirSync(RAW_DIR)

try{
    for (const file of files){
        const filePath = path.join(RAW_DIR, file)
        const messageRaw = await readFile(filePath, 'utf-8')
        const message = parseMessage(JSON.parse(messageRaw))
        const receivedAt = new Date(message.date)

        const listingItems = await parseListing(message.htmlBody)
        for (const newListing of listingItems){
            await db.insert(listings).values({
                ...newListing,
                firstSeenAt: receivedAt,
                lastSeenAt: receivedAt
            })
            .onConflictDoUpdate({
                target: listings.rentalId,
                set: {brokerage: sql`coalesce(nullif(${listings.brokerage}, ''), nullif(excluded.brokerage, ''))`},
            });
        }
    }
} finally{
    await client.end();
}
