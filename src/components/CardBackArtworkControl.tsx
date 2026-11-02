import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { CardFace } from '../lib/types';
import { usesMpcTrim, withMpcTrim } from '../lib/artwork';
import ArtworkTrimControl from './ArtworkTrimControl';

export default function CardBackArtworkControl({
  artwork,
  change,
  readArtwork,
  working,
  disabled,
}: {
  artwork?: CardFace;
  change: (artwork?: CardFace) => void;
  readArtwork: (file: File) => Promise<CardFace>;
  working: (busy: boolean) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    working(true);
    setError('');
    try {
      change(await readArtwork(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read card-back artwork.');
    } finally {
      working(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="default-back-artwork">
      <div className="back-artwork-control">
        {artwork ? (
          <span className="back-artwork-preview">
            <img
              className={usesMpcTrim(artwork) ? 'mpc-source-art' : undefined}
              src={artwork.preview}
              alt="Default shared card-back artwork"
            />
          </span>
        ) : (
          <div className="back-art-placeholder">
            <ImagePlus size={22} />
            <span>No back art</span>
          </div>
        )}
        <div>
          <strong>{artwork?.name || 'Choose a shared card back'}</strong>
          <small>
            Single-sided cards use this artwork. Double-sided cards use their matching reverse face.
          </small>
          <div className="default-artwork-actions">
            <button
              className="secondary compact"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              <ImagePlus size={14} /> {artwork ? 'Replace artwork' : 'Upload artwork'}
            </button>
            {artwork && (
              <button
                className="text-button compact"
                disabled={disabled}
                onClick={() => {
                  change(undefined);
                  setError('');
                }}
              >
                <X size={14} /> Remove artwork
              </button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {artwork && (
        <ArtworkTrimControl
          face={artwork}
          change={(enabled) => change(withMpcTrim(artwork, enabled))}
        />
      )}

      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
