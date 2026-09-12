# Alert fixtures

`two-listings.html` is the shape of a StreetEasy listing alert, reduced to the
elements the parser reads. Two cards are well formed; the third has no price,
so it exercises per-card isolation. Addresses and tracking links are synthetic.

Real alerts carry at most five cards even when the subject claims more results,
so a listing beyond the fifth is never ingested from mail.
