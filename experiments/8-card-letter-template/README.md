# Experimental eight-card Tabloid capture to US Letter

This magenta template is the eight-card setup image for Skarix's experimental
registered-print profile. Design Space creates a complete portrait Tabloid PDF;
Skarix checks its slots and marks, then reframes the page content onto portrait
US Letter without scaling the cards.

## Geometry

- Card trim size: 63 × 88 mm (2.4803 × 3.4646 in)
- Layout: two horizontal cards per row, four rows
- Card corner radius: 2.5 mm
- Transparent gap: 1 mm
- Complete image size: 177 × 255 mm (6.9685 × 10.0394 in)
- PNG: 4181 × 6024 px at 600 DPI
- Color: Skarix capture magenta, `#e600c8`

## Design Space capture

1. Select the eight-card profile in Skarix. Upload its setup PNG (or the
   matching PNG in this folder) to Design Space as one flat Print Then Cut
   image. Keep the transparent background and all eight slots together.
2. Set both Canvas dimensions to **6.9685 × 10.0394 in** (177 × 255 mm).
   Do not auto-resize, rearrange, or add an offset.
3. Select **portrait Tabloid (11 × 17 in)** in Design Space and the system
   printer dialog. Save one complete Tabloid PDF at **100% / Actual size** with
   bleed off. Check all four sensor marks in its preview.
4. Import that PDF into Skarix's **Create print PDF** flow. Skarix rejects it
   if the card pattern, scale, marks, or complete printed footprint do not
   pass its Letter fit checks. Export a US Letter size-check PDF.
5. Print the size-check page at actual size on plain paper. Confirm that the
   printer leaves every mark intact, then measure a cut card before using card
   stock. Keep the saved Design Space cut job and mat unchanged.

The supplied `2x4-test.pdf` capture passed software pattern and Letter-fit
checks for the earlier 0.1 mm-gap geometry. Its marked footprint was about
7.63 × 10.63 in, leaving about 0.19 in above and below when centered on Letter.
The revised 1 mm-gap geometry needs a new Tabloid capture and Letter-fit check.
Printer imageable area, Cricut sensor acquisition, and cut accuracy still need
physical validation. An earlier
A4-on-Letter print-preview experiment produced two pages; that route is not
used by this profile.

The SVG is an exact vector reference. The transparent PNG is the intended
Print Then Cut upload. Design Space, not this image, supplies the sensor marks.
