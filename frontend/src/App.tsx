import { BestLookup } from "./components/BestLookup";
import { ExerciseList, PeopleList } from "./components/Catalog";
import { Datalists } from "./components/common";
import { DataTools, History } from "./components/History";
import { InventoryEditor } from "./components/InventoryEditor";
import { PRHelper, TargetsOverview } from "./components/Overview";
import { SessionView } from "./components/SessionView";
import { StartSession } from "./components/StartSession";
import { useStore } from "./store";

export default function App() {
  const { loaded, error, active, viewing } = useStore();
  const shown = viewing || active;
  const home = !shown;

  if (!loaded) return <div className="container"><h1>Gym Tracker</h1><div className="empty">Loading…</div></div>;
  if (error && !shown) {
    return (
      <div className="container">
        <h1>Gym Tracker</h1>
        <div className="card">
          <p>Can't reach the backend: {error}</p>
          <p className="data-tools-note">Start it with <code>run.ps1</code> (see README), then reload this page.</p>
        </div>
      </div>
    );
  }

  const classes = ["container", shown && shown.participants.length > 1 && "wide", shown && "has-session"];
  return (
    <div className={classes.filter(Boolean).join(" ")}>
      <Datalists />
      <h1>Gym Tracker</h1>
      {home && <StartSession />}
      <div className="session-layout">
        <div id="current-session">{shown && <SessionView key={shown.id} session={shown} isActive={!viewing} />}</div>
        <div id="best-lookup">
          <BestLookup />
          <PRHelper />
        </div>
      </div>
      {home && <TargetsOverview />}
      {home && (
        <>
          <InventoryEditor />
          <ExerciseList />
          <PeopleList />
          <DataTools />
        </>
      )}
      {!viewing && <History />}
    </div>
  );
}
