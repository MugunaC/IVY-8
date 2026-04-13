import { ChevronDown, ChevronRight, Flag, Search } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { OverlayModal } from '@/app/components/ui/overlay-modal';

type FocusMapSearchOverlayProps = {
  open: boolean;
  searchQuery: string;
  searchStatus: string | null;
  searchActionsOpen: boolean;
  savePromptOpen: boolean;
  savePromptName: string;
  missionCanSave: boolean;
  planningEnabled: boolean;
  lastSearchCoords: { lat: number; lng: number } | null;
  onClose: () => void;
  onSearchQueryChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  onToggleActions: () => void;
  onAddWaypoint: () => void;
  onOpenSavePrompt: () => void;
  onSavePromptNameChange: (value: string) => void;
  onSavePromptConfirm: () => Promise<void> | void;
  onCloseSavePrompt: () => void;
};

export function FocusMapSearchOverlay(props: FocusMapSearchOverlayProps) {
  const {
    open,
    searchQuery,
    searchStatus,
    searchActionsOpen,
    savePromptOpen,
    savePromptName,
    missionCanSave,
    planningEnabled,
    lastSearchCoords,
    onClose,
    onSearchQueryChange,
    onSubmit,
    onToggleActions,
    onAddWaypoint,
    onOpenSavePrompt,
    onSavePromptNameChange,
    onSavePromptConfirm,
    onCloseSavePrompt,
  } = props;

  return (
    <OverlayModal open={open} title="Search" onClose={onClose} maxWidthClassName="max-w-md">
      <div className="grid gap-3 text-sm">
        <Input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="City, landmark, or lat,lng"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void onSubmit();
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void onSubmit()}>
            <Search className="mr-2 size-4" />
            Search
          </Button>
          <Button size="sm" variant="outline" onClick={onToggleActions}>
            <ChevronDown className="mr-2 size-4" />
            Route actions
          </Button>
        </div>
        {searchStatus && <div className="text-xs text-muted-foreground">{searchStatus}</div>}
        {searchActionsOpen && (
          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
            <Button
              size="sm"
              variant="outline"
              onClick={onAddWaypoint}
              disabled={!lastSearchCoords || !planningEnabled}
              title={planningEnabled ? 'Add waypoint at search result' : 'Enable planning to add waypoints'}
              className="justify-start"
            >
              <Flag className="mr-2 size-4" />
              Add waypoint
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={onOpenSavePrompt}
              disabled={!missionCanSave}
              title={missionCanSave ? 'Save route to missions' : 'Add at least 2 waypoints'}
            >
              <ChevronRight className="mr-2 size-4" />
              Save route
            </Button>
            {savePromptOpen && (
              <div className="mt-1 grid gap-2 rounded-md border border-border/70 bg-background/60 p-2">
                <div className="text-xs text-muted-foreground">Save route as</div>
                <Input
                  value={savePromptName}
                  onChange={(event) => onSavePromptNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onSavePromptConfirm();
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void onSavePromptConfirm()}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={onCloseSavePrompt}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </OverlayModal>
  );
}
