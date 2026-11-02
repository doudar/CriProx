# Experimental seven-card US Letter template

This is the Design Space acceptance test used to develop Skarix's experimental
seven-card 2-3-2 layout profile. The Tabloid-to-Letter system preview produced
one page with all seven slots and four sensor marks; physical sensor acquisition
and cutting still require validation.

## Geometry

- Card trim size: 63 × 88 mm (2.4803 × 3.4646 in)
- Layout: two rotated, three upright, two rotated
- Card corner radius: 2.5 mm
- Transparent gap: 0.1 mm
- Complete image size: 189.2 × 214.2 mm (7.4488 × 8.4331 in)
- PNG: 4469 × 5060 px at 600 DPI
- Color: Skarix capture magenta, `#e600c8`

The widest portion is the three-card center row. The top and bottom rows are
only 176.1 mm (6.9331 in) wide, leaving more room for the four corner sensor
marks. The shorter 214.2 mm height should keep the lower marks on the first
Letter page.

## Design Space test

1. Select the actual Cricut machine and set the Design Space Print Then Cut
   paper to **Tabloid (11 × 17 in)**. A4 mode is too narrow for the center row.
2. Upload `seven-card-letter-test-600dpi.png` as one flat Print Then Cut image.
   Keep the transparent background; do not add an offset or remove the
   background.
3. Set both Canvas dimensions to **7.4488 in wide × 8.4331 in high**
   (189.2 × 214.2 mm). Do not allow Auto-Resize.
4. Confirm that Design Space shows exactly seven separate rounded contours.
5. Select Make. Keep the seven slots together and move the complete image
   toward the upper-left of the printable area if Design Space permits it.
6. Open the system printer dialog and change the paper to **8.5 × 11 in US
   Letter** at **Actual Size / 100%**. Do not use Fit, Shrink, or Scale to Fit.
7. The experiment succeeds only if the preview shows exactly one Letter page
   containing all seven pink slots and all four complete sensor marks. If it
   shows two pages or clips any mark, stop and do not print.
8. If the preview passes, save a one-page PDF or make a test print on plain
   paper. Confirm that the Cricut reads every mark and that every cut card
   measures 63 × 88 mm before using card stock.

Selecting a larger Design Space page and printing to Letter is outside Cricut's
supported workflow. Some machines may also demand a longer mat because
Design Space still sees a Tabloid job. Preview and test results can vary by
Design Space version, machine, operating system, and printer driver.

Community walkthrough of the larger-page technique:
https://dinosaurmama.com/post/cricut-print-then-cut-maximum/

Official Cricut area limits:
https://help.cricut.com/hc/en-us/articles/360009429814-How-large-can-I-Print-Then-Cut
