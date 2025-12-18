# Crowd Management System

A real-time web application for monitoring crowd occupancy, footfall, demographics, and visitor entries in public venues like malls, offices, and campuses.

## 🚀 Features

- **Live Dashboard** - Real-time occupancy tracking with live updates via Socket.IO
- **Summary Metrics** - Today's footfall, average dwell time, and live occupancy with percentage comparisons
- **Interactive Charts** - Occupancy timeline and demographics visualization
- **Visitor Records** - Paginated entry/exit records with detailed visitor information
- **Multi-site Support** - Switch between different venues/locations
- **Historical Data** - View data for any past date using date picker
- **Bilingual Support** - English and Arabic language toggle

## 🛠️ Tech Stack

- **Angular 17** (Standalone Components)
- **Angular Material** (UI Components)
- **ngx-charts** (Data Visualization)
- **Socket.IO Client** (Real-time Updates)
- **RxJS** (Reactive Programming)
- **TypeScript**

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn

## ⚡ Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Open http://localhost:4200
```

## 🏗️ Build for Production

```bash
npm run build

# Output: dist/crowd-management-ui/
```

## 📁 Project Structure

```
src/app/
├── features/          # Feature modules
│   ├── auth/         # Login page
│   ├── dashboard/    # Main dashboard with charts
│   └── entries/      # Visitor records table
├── layout/           # App shell (sidebar, header)
├── core/             # Core services & guards
│   ├── services/     # API, Auth, Socket services
│   ├── guards/       # Route guards
│   └── interceptors/ # HTTP interceptors
└── shared/           # Shared components
```

## 🔌 API Configuration

Update `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://your-api-url.com/api',
  socketUrl: 'https://your-api-url.com'
};
```

## ✨ Key Features Explained

### Real-time Updates
- Automatic live occupancy updates via WebSocket
- Footfall count refreshes automatically on entry/exit events
- No page refresh needed

### Performance Optimizations
- OnPush change detection strategy
- API response caching
- Batch API calls for faster loading
- Optimized chart rendering

### Security
- JWT-based authentication
- Protected routes with auth guards
- Secure token storage

## 📝 Assignment Requirements

✅ Login screen with password visibility toggle  
✅ Dashboard with live occupancy, footfall, and dwell time  
✅ Percentage comparison with yesterday  
✅ Occupancy timeline chart  
✅ Demographics charts (pie + timeline)  
✅ Entry/exit records table with pagination  
✅ Real-time updates via Socket.IO  
✅ Multi-site selection  
✅ Date selection for historical data  

## 🎯 Performance

- Dashboard loads within 2-5 seconds
- Optimized API calls with caching
- Efficient change detection
- Responsive charts that adapt to screen size

## 📦 Deployment

Deploy the built files from `dist/crowd-management-ui/` to any static hosting service:

- Netlify
- Vercel
- GitHub Pages
- Firebase Hosting
- Any web server capable of serving static files

## 📄 License

This project is part of a hiring assessment for Kloudspot.

## 👤 Author

Built as a frontend assignment demonstrating:
- Angular best practices
- Real-time data handling
- Performance optimization
- Clean code architecture
