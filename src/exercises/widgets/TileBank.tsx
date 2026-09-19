import { useT } from '../../i18n';
import { TileButton } from './TileButton';
import type { Tile } from './tiles';

interface TileBankProps {
  tiles: Tile[];
  placedIds: string[];
  onChange: (placedIds: string[]) => void;
  /** How many slots the answer line hints at (usually the expected token count). */
  slots?: number;
}

/**
 * Shuffled bank of word tiles plus the answer line above it. Tapping a bank tile
 * appends it; tapping a placed tile returns it. Used tiles stay in the bank as
 * invisible placeholders so the layout never jumps.
 */
export function TileBank({ tiles, placedIds, onChange, slots }: TileBankProps) {
  const t = useT();
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const placed = placedIds.map((id) => byId.get(id)).filter((tile): tile is Tile => Boolean(tile));
  const emptySlots = Math.max(0, (slots ?? 0) - placed.length);

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-label={t('session.answerLine')}
        className="flex min-h-[4.25rem] flex-wrap content-start items-start gap-2 rounded-2xl border border-dashed border-line bg-sheet/60 p-2"
      >
        {placed.map((tile) => (
          <TileButton
            key={tile.id}
            label={tile.label}
            variant="placed"
            ariaLabel={t('session.removeTile', { word: tile.label })}
            onClick={() => onChange(placedIds.filter((id) => id !== tile.id))}
          />
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <span
            key={`slot-${i}`}
            aria-hidden
            className="min-h-11 w-12 rounded-xl border border-dashed border-line"
          />
        ))}
      </div>

      <div aria-label={t('session.tileBank')} className="flex flex-wrap gap-2">
        {tiles.map((tile) => (
          <TileButton
            key={tile.id}
            label={tile.label}
            ariaLabel={t('session.addTile', { word: tile.label })}
            hidden={placedIds.includes(tile.id)}
            onClick={() => onChange([...placedIds, tile.id])}
          />
        ))}
      </div>
    </div>
  );
}
