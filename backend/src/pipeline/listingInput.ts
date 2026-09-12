import type {Listing as GmailListing} from '../gmail/listings.ts';
import {parseEmailListing} from '../enrichment/service.ts';
import type {EmailListing} from '../enrichment/service.ts';
import {splitBrokerage} from './brokerage.ts';

export function gmailListingToEmailInput(listing: GmailListing): EmailListing {
  const {brokerageName, officeAddress} = splitBrokerage(listing.brokerage);
  return parseEmailListing({
    address: listing.address,
    price: listing.price,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    brokerage: brokerageName,
    brokerageOfficeAddress: officeAddress,
    city: 'New York',
  });
}
