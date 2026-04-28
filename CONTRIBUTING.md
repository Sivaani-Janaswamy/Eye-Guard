# Contributing to EyeGuard

Thank you for your interest in contributing to EyeGuard! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Git
- Chrome/Chromium browser (for extension testing)

### Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/your-username/EyeGuard.git
   cd EyeGuard
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install dashboard dependencies
   cd eyehealth/dashboard
   npm install
   
   # Install extension dependencies
   cd ../extension
   npm install
   ```

3. **Build the project**
   ```bash
   # Build dashboard
   cd eyehealth/dashboard
   npm run build
   
   # Build extension
   cd ../extension
   npm run build:ext
   ```

## Project Structure

```
EyeGuard/
├── eyehealth/
│   ├── dashboard/          # React dashboard application
│   │   ├── src/
│   │   │   ├── components/ # React components
│   │   │   ├── pages/      # Dashboard pages
│   │   │   └── index.css   # Global styles
│   │   └── public/         # Static assets
│   └── extension/          # Chrome extension
│       ├── background/     # Service worker
│       ├── content/        # Content scripts
│       ├── popup/          # Extension popup
│       └── manifest.json   # Extension manifest
└── README.md
```

## Development

### Dashboard Development

The dashboard is a React application with TypeScript:

```bash
cd eyehealth/dashboard
npm run dev     # Start development server
npm run build   # Build for production
npm run lint    # Run linter
```

### Extension Development

The Chrome extension consists of:

- **Service Worker** (`background/`) - Handles background tasks
- **Content Scripts** (`content/`) - Injected into web pages
- **Popup** (`popup/`) - Extension popup interface

```bash
cd eyehealth/extension
npm run build:ext    # Build extension
npm run dev:ext      # Watch mode for development
```

### Testing the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `eyehealth/extension` directory

## Code Style

### General Guidelines

- Use TypeScript for type safety
- Follow existing code patterns and conventions
- Keep components small and focused
- Use descriptive variable and function names
- Add comments for complex logic

### CSS/Styling

- Use Tailwind CSS classes where possible
- For custom styles, use CSS variables defined in `index.css`
- Maintain consistency with the existing design system
- Test both light and dark modes

### React Components

- Use functional components with hooks
- Implement proper error boundaries
- Use memo for performance optimization where needed
- Follow the existing component structure

## Submitting Changes

1. **Create a new branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the coding guidelines
   - Test your changes thoroughly
   - Update documentation if needed

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

4. **Push and create a pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Pull Request Guidelines

- Provide a clear description of your changes
- Include screenshots for UI changes
- Test both dashboard and extension functionality
- Ensure all builds pass without errors
- Update documentation as needed

## Common Issues

### Extension Not Loading

- Check the manifest.json for syntax errors
- Ensure all file paths are correct
- Check Chrome DevTools for console errors

### Dashboard Build Errors

- Clear node_modules and reinstall dependencies
- Check TypeScript configuration
- Verify all imports are correct

### Styling Issues

- Ensure CSS variables are properly defined
- Check for conflicting styles
- Test in both light and dark modes

## Getting Help

- Check existing issues and discussions
- Create a new issue with detailed information
- Include screenshots and error messages
- Provide steps to reproduce any bugs

## License

By contributing to EyeGuard, you agree that your contributions will be licensed under the same license as the project.
