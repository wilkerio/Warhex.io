export default class Viewport {
    constructor (safeWidth = 0, safeHeight = 0) {
        // Define the screen size and safe area
        this.viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        this.screen = {
            width: window.screen.width,
            height: window.screen.height,
            safeWidth: safeWidth,
            safeHeight: safeHeight
        };
    }

    // Method to adjust canvas size based on screen size
    resize (canvas) {
        // Get current viewport size
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        let newGameWidth, newGameHeight, newGameX, newGameY;

        // Check if aspect ratio of the screen is smaller than that of the canvas
        if (this.screen.height / this.screen.width > viewport.height / viewport.width) {
            // If yes, check if the safe area exceeds the visible area
            if (this.screen.safeHeight / this.screen.width > viewport.height / viewport.width) {
                // A: Adjust scaling to make the safe area visible
                newGameHeight = viewport.height * this.screen.height / this.screen.safeHeight;
                newGameWidth = newGameHeight * this.screen.width / this.screen.height;
            } else {
                // B: Adjust scaling to show the visible area
                newGameWidth = viewport.width;
                newGameHeight = newGameWidth * this.screen.height / this.screen.width;
            }
        } else {
            // Apply the same principle for width aspect ratio
            if (this.screen.height / this.screen.safeWidth > viewport.height / viewport.width) {
                // C: Adjust scaling to show the visible area
                newGameHeight = viewport.height;
                newGameWidth = newGameHeight * this.screen.width / this.screen.height;
            } else {
                // D: Adjust scaling to make the safe area visible
                newGameWidth = viewport.width * this.screen.width / this.screen.safeWidth;
                newGameHeight = newGameWidth * this.screen.height / this.screen.width;
            }
        }

        canvas.width = this.screen.width;
        canvas.height = this.screen.height;

        // Adjust canvas size
        canvas.style.width = `${newGameWidth}px`;
        canvas.style.height = `${newGameHeight}px`;

        // Calculate new center point to center the canvas
        newGameX = (viewport.width - newGameWidth) / 2;
        newGameY = (viewport.height - newGameHeight) / 2;

        // Update canvas position to center it
        canvas.style.margin = `${newGameY}px ${newGameX}px`;
    }
}