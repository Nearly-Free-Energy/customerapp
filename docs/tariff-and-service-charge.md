# Tariff and service charge — how the customer bill is built

The bill in `src/utils/usage.ts` is:

```
bill = (tiered energy charge + monthly service charge) x (1 + VAT)
```

This structure matches the actual UEDCL bill (meter U214624) exactly, where VAT is
applied on top of energy + service charge.

## Service charge — this is NFE's OWN price, not UEDCL's

`MONTHLY_SERVICE_CHARGE_UGX` is a **deliberate NFE premium over UEDCL**, not a
pass-through:

- UEDCL charges **NFE** 3,360/month (the SERVICE CHARGE line on NFE's Code 10.2
  commercial bill). That is NFE's **cost**, not the customer price.
- NFE charges its residential customers a **premium**: **5,320** at launch (for a
  better experience than UEDCL), raised **+2,000 to 7,320** because NFE now
  provides **battery backup covering daytime outages** (decision: Aaron, 2026-07-31).

Do not "correct" the service charge down to UEDCL's 3,360 — that would confuse
NFE's cost with NFE's price.

## Energy tiers — ERA domestic (Code 10.1)

Tiered by monthly consumption: first 15 units (lifeline), 16-80, 81-150 (cooking
tariff), 150+. Rates come from the ERA quarterly schedule (kept in
`NFE/CUSTOM_CODE/utility_bill_rates/`). Q3 2026: 250 / 779.4 / 412 / 779.4. Whether
NFE passes ERA quarterly changes through to customers is a business decision
(see #17).

## VAT

18% applied to (energy + service charge). Matches the real bill.

## Lifeline eligibility

The 250 lifeline (first 15 units) is only for customers whose **rolling 6-month
average consumption <= 100 kWh** (ERA). See #16. Enforcement must wait until a
customer has a defendable 6-month window of data; before that, default eligible
(never deny a lifeline on an incomplete, non-ERA-compliant basis).
