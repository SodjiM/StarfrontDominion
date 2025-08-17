import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import BlogIndex from './routes/BlogIndex.jsx';
import BlogPost from './routes/BlogPost.jsx';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/blog', element: <BlogIndex /> },
  { path: '/blog/:slug', element: <BlogPost /> },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);


