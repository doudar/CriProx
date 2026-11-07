import assert from 'node:assert/strict';
import { GlobalFonts } from '@napi-rs/canvas';

// Hosted Linux images need an explicit Arial alias for native canvas text tests.
const font = process.env.SKARIX_TEST_FONT;
if (font)
  assert.ok(GlobalFonts.registerFromPath(font, 'Arial'), `Could not load test font: ${font}`);
