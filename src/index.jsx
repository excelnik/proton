const { createRoot } = require('react-dom/client')
const React = require('react')
const App = require('./App.jsx')

const root = createRoot(document.getElementById('root'))
root.render(React.createElement(App))