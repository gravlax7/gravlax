import { render } from 'solid-js/web'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import App from './App'
import './theme/tokens.css'
import './ui/ui.css'

render(() => <App />, document.getElementById('root')!)
