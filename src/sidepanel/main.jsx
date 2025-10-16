﻿import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './sidepanel.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Side panel root element not found');
}

createRoot(container).render(<App />);
