import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createCategoryAction } from "@/functions/planejamento-actions";

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly isBase: boolean;
}

/**
 * DEC-135: the ONE canonical category selector reused everywhere a category
 * is chosen (pending classification, transaction correction, rule creation,
 * recurring-candidate confirmation). Base categories are listed before
 * personal ones; the only way to introduce free text is the explicit
 * "+ Criar nova categoria" action, which immediately creates and selects a
 * real personal category — there is no path to submit an arbitrary
 * unregistered category name through the normal picker.
 */
export function CategoryPicker({
  categories,
  value,
  onSelect,
  onCategoryCreated,
  placeholder,
}: {
  categories: readonly CategoryOption[];
  value: string | null;
  onSelect: (category: CategoryOption) => void;
  onCategoryCreated: (category: CategoryOption) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selected = categories.find((c) => c.id === value);
  const filtered = [...categories]
    .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.name.localeCompare(b.name));

  function closeAndReset() {
    setOpen(false);
    setQuery("");
    setIsCreating(false);
    setNewName("");
    setError(null);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setIsSaving(true);
    setError(null);
    const result = await createCategoryAction({ data: { name: newName.trim() } });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const created: CategoryOption = {
      id: result.category.id,
      name: result.category.name,
      isBase: false,
    };
    onCategoryCreated(created);
    onSelect(created);
    closeAndReset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13.5px]"
      >
        <span className={selected ? "font-medium" : "text-muted-foreground"}>
          {selected?.name ?? placeholder ?? "Selecionar categoria"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="surface flex flex-col gap-2 p-3">
      {isCreating ? (
        <>
          <p className="text-[12.5px] font-semibold">Nova categoria</p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome"
            autoFocus
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void handleCreate()}
              disabled={isSaving || !newName.trim()}
            >
              Criar e usar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCreating(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
          </div>
        </>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar categoria"
            autoFocus
          />
          <div className="flex max-h-52 flex-col overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  closeAndReset();
                }}
                className={`rounded-lg px-2 py-2 text-left text-[13px] ${
                  c.id === value ? "bg-accent font-semibold" : "hover:bg-accent"
                }`}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">
                Nenhuma categoria encontrada
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-primary hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar nova categoria
          </button>
          <button
            type="button"
            onClick={closeAndReset}
            className="text-center text-[12px] text-muted-foreground"
          >
            Cancelar
          </button>
        </>
      )}
    </div>
  );
}
