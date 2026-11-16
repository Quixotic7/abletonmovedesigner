import { useStore } from './store'
import { Board } from './components/Board'
import { Toolbar } from './components/Toolbar'
import { Inspector } from './components/Inspector'
import { MetaDialog } from './components/MetaDialog'
import { ScreenEditor } from './components/ScreenEditor'
import { HelpDialog } from './components/HelpDialog'
import { useShortcuts } from './shortcuts'

export default function App() {
  useShortcuts()
  const dialog = useStore((s) => s.dialog)
  return (
    <div className="app">
      <Board />
      <Toolbar />
      <Inspector />
      {dialog?.kind === 'meta' && <MetaDialog key={dialog.controlIds.join()} layoutId={dialog.layoutId} controlIds={dialog.controlIds} />}
      {dialog?.kind === 'screen' && <ScreenEditor layoutId={dialog.layoutId} />}
      {dialog?.kind === 'help' && <HelpDialog />}
    </div>
  )
}
