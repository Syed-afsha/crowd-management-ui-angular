# How to Upload This Project to GitHub

Follow these simple steps to upload your project to GitHub.

## Step 1: Create a New Repository on GitHub

1. Go to [https://github.com/new](https://github.com/new)
2. Repository name: `Crowd-management-ui` (or any name you prefer)
3. Description: "Real-time crowd management dashboard built with Angular 17"
4. Choose **Public** or **Private**
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click **"Create repository"**

## Step 2: Upload via Git Commands

Open terminal/command prompt in the `Crowd-management-ui` folder and run:

```bash
# Initialize git (already done if you see this)
git init

# Add all files
git add .

# Commit files
git commit -m "Initial commit: Crowd Management System"

# Add your GitHub repository as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/Manavbarodiya/Crowd-management-ui.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Alternative - Upload via GitHub Desktop

1. Download [GitHub Desktop](https://desktop.github.com/)
2. Open GitHub Desktop
3. File → Add Local Repository
4. Select the `Crowd-management-ui` folder
5. Click "Publish repository" button
6. Enter repository name and description
7. Click "Publish Repository"

## Step 4: Verify Upload

1. Go to your GitHub profile: https://github.com/Manavbarodiya
2. You should see your new repository
3. Click on it to view all files

## Quick Commands Reference

```bash
# If you make changes later
git add .
git commit -m "Your commit message"
git push
```

## Troubleshooting

**If you get authentication error:**
- Use GitHub Personal Access Token instead of password
- Create token: Settings → Developer settings → Personal access tokens → Generate new token
- Use token as password when pushing

**If repository already exists:**
```bash
git remote set-url origin https://github.com/Manavbarodiya/Crowd-management-ui.git
git push -u origin main
```

---

**Need help?** GitHub documentation: https://docs.github.com/en/get-started
