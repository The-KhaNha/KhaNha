import type { ModifierGroup } from '../../types/api';
import { cn } from '../../lib/cn';
import { choiceHint, deltaLabel, toggleOption, type Selection } from './modifierRules';

interface ModifierPickerProps {
  groups: ModifierGroup[];
  selection: Selection;
  onChange: (selection: Selection) => void;
  /** Groups to flag with "Choose one" (the customer tried to add without them). */
  missing: ReadonlySet<string>;
  /** The item's id: names the inputs, so two sheets never share a radio group. */
  itemId: string;
}

/**
 * The item's choices in the item sheet (P3.2): radio buttons when a group takes one option, checkboxes otherwise
 * (the rest switch off at the group's maximum). Each row is a 44px label, so the whole row is the tap target, and the
 * native inputs carry keyboard and screen-reader behaviour. A sold-out option stays listed, switched off.
 */
export function ModifierPicker({
  groups,
  selection,
  onChange,
  missing,
  itemId,
}: ModifierPickerProps) {
  return (
    <div className="mt-5 space-y-5">
      {groups.map((group) => {
        const chosen = selection[group.id] ?? [];
        const single = group.maxSelect === 1;
        const full = !single && chosen.length >= group.maxSelect;
        const hintId = `${itemId}-${group.id}-hint`;
        return (
          <fieldset key={group.id} aria-describedby={hintId} data-group={group.id}>
            <legend className="flex w-full items-baseline justify-between gap-3">
              <span className="text-body font-bold">{group.name}</span>
              <span
                id={hintId}
                className={cn(
                  'text-caption',
                  missing.has(group.id) ? 'font-semibold text-brand-600' : 'text-muted',
                )}
              >
                {missing.has(group.id)
                  ? group.minSelect === 1
                    ? 'Choose one'
                    : `Choose ${group.minSelect}`
                  : choiceHint(group)}
              </span>
            </legend>
            <div className="mt-1.5 divide-y divide-line/70">
              {group.options.map((option) => {
                const checked = chosen.includes(option.id);
                const disabled = !option.isAvailable || (full && !checked);
                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 py-1.5',
                      disabled && 'cursor-not-allowed text-muted',
                    )}
                  >
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={`${itemId}-${group.id}`}
                      value={option.id}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onChange(toggleOption(group, selection, option.id))}
                      className="h-5 w-5 shrink-0 accent-brand-500"
                    />
                    <span className="min-w-0 flex-1 wrap-anywhere text-body">{option.name}</span>
                    <span className="shrink-0 text-caption tabular-nums text-muted">
                      {option.isAvailable ? deltaLabel(option.priceDelta) : 'Sold out'}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
