import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/design-system.css';
import './styles.css';
import './styles-overrides.css';
import './styles/refresh.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
