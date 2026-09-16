import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import BlogIndex from './routes/BlogIndex.jsx';
import BlogPost from './routes/BlogPost.jsx';
import InfoPlaceholderPage from './routes/InfoPlaceholderPage.jsx';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/game', element: <InfoPlaceholderPage section="The Game" title="A living frontier, one turn at a time." description="The complete game guide is being charted. Return soon for systems, strategy, and what to expect beyond the frontier." /> },
  { path: '/ships', element: <InfoPlaceholderPage section="Ships" title="Every hull tells a story." description="The fleet archive is being assembled. Ship classes, roles, and field notes will live here." /> },
  { path: '/blog', element: <BlogIndex /> },
  { path: '/blog/:slug', element: <BlogPost /> },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

