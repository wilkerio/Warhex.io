export default class Toolbar {
    constructor (core, items, onSelectBuilding) {
        this.core = core;
        this.container = document.getElementById("toolbar-container");
        this.items = items;
        this.onSelectBuilding = onSelectBuilding;
        this.color = "#60eaff";
        this.tooltips = {}; // Store tooltips by building type for easy updates
    }

    init () {
        if (!this.container) {
            console.error("Toolbar container not found");
            return;
        }

        this.container.innerHTML = '';
        const scale = 0.8;

        this.items.forEach((itemClass, index)  => {
            const toolbarItem = this.createToolbarItem(itemClass, scale, index);
            this.container.appendChild(toolbarItem);
        });
    }

    changeColor (newColor) {
        this.color = newColor;
        this.items.forEach((itemClass, index) => {
            const toolbarItem = this.container.querySelector(`.toolbar-item-${index}`);
            const iconCanvas = this.createIconCanvas(new itemClass(this.color), 0.8);
            toolbarItem.replaceChild(iconCanvas, toolbarItem.querySelector("canvas"));
        });
    }

    createToolbarItem (itemClass, scale, index) {
        const toolbarItem = document.createElement("div");
        toolbarItem.className = `toolbar-item toolbar-item-${index}`;

        // Create an instance of the building object
        const item = new itemClass(this.color);
        const details = item.details;

        // Get the building limits from GameManager
        const buildingLimit = this.getBuildingLimit(item.type);

        // Add disabled class if limit reached
        if (buildingLimit.current >= buildingLimit.limit) {
            toolbarItem.classList.add('disabled');
        }

        // Add data attribute for building type
        toolbarItem.setAttribute('data-building-type', item.type);

        // Create the tooltip with the building limit and store its reference for later updates
        const tooltip = this.createTooltip(details.name, details.description, details.cost, buildingLimit);
        toolbarItem.appendChild(tooltip);

        // Store tooltip reference
        this.tooltips[item.type] = tooltip.querySelector('.tooltip-limit');

        // Event listeners for toolbar item
        toolbarItem.addEventListener("mouseenter", () => {
            tooltip.style.visibility = "visible";
            this.core.inputManager.removeSelectionCircle();
        });

        toolbarItem.addEventListener("mouseleave", () => {
            tooltip.style.visibility = "hidden";
        });

        toolbarItem.addEventListener("click", () => {
            // Check if the current building count is below the limit
            if (buildingLimit.current < buildingLimit.limit) {
                if (this.onSelectBuilding) {
                    this.onSelectBuilding(itemClass);
                }
                this.core.uiManager.hideUpgrades();
            } else {
                console.error(`Cannot select ${details.name}. Limit of ${buildingLimit.limit} reached.`);
            }
        });

        const iconCanvas = this.createIconCanvas(item, scale);
        toolbarItem.appendChild(iconCanvas);

        return toolbarItem;
    }

    createTooltip (name, description, cost, buildingLimit) {
        const limitDisplay = buildingLimit.limit === 9999
            ? '<span class="infinity-symbol">∞</span>'
            : buildingLimit.limit;

        const tooltip = document.createElement("div");
        tooltip.className = "tooltip";
        tooltip.innerHTML = `
            <div class="tooltip-limit">${buildingLimit.current}/${limitDisplay}</div>
            <div class="tooltip-header">${name}</div>
            <div class="tooltip-content">${description}</div>
            <div class="tooltip-cost">Cost: ${cost} Power</div>
        `;
        tooltip.style.visibility = "hidden";
        return tooltip;
    }

    createIconCanvas (item, scale) {
        const iconCanvas = document.createElement("canvas");
        iconCanvas.width = 80;
        iconCanvas.height = 80;
        const iconContext = iconCanvas.getContext("2d");
        iconContext.scale(scale, scale);
        iconContext.lineJoin = "round";
        iconContext.lineCap = "round";
        item.render(iconContext, { x: -iconCanvas.width / (2 * scale), y: -iconCanvas.height / (2 * scale) }, 0);
        return iconCanvas;
    }

    selectByIndex (index) {
        if (this.core.uiManager.isChatInputFocused ||
            this.core.uiManager.menuOpen
        ) return;
        if (index >= 0 && index < this.items.length) {
            const itemClass = this.items[index];
            // Create an instance of the building object to access its type
            const item = new itemClass(this.color);
            const buildingLimit = this.getBuildingLimit(item.type); // Use item.type instead of itemClass

            if (buildingLimit.current < buildingLimit.limit) {
                if (this.onSelectBuilding) {
                    this.onSelectBuilding(itemClass);
                }
                this.core.uiManager.hideUpgrades();
            } else {
                console.error(`Cannot select building. Limit of ${buildingLimit.limit} reached.`);
            }
        }
    }

    // Get the building limit based on the itemClass
    getBuildingLimit (buildingType) {
        const buildingLimit = this.core.gameManager.buildingLimits.find(limit => limit.type === buildingType);
        return buildingLimit ? buildingLimit : { current: 0, limit: 1 }; // Default to 0/1 if not found
    }

    // New method to update the building limit display
    updateBuildingLimit (buildingType, newCurrent) {
        const tooltipLimit = this.tooltips[buildingType];
        if (tooltipLimit) {
            const buildingLimit = this.getBuildingLimit(buildingType);
            const limitDisplay = buildingLimit.limit === 9999
                ? '<span class="infinity-symbol">∞</span>'
                : buildingLimit.limit;
            tooltipLimit.innerHTML = `${newCurrent}/${limitDisplay}`;

            // Update disabled state
            const toolbarItem = this.container.querySelector(`[data-building-type="${buildingType}"]`);
            if (toolbarItem) {
                if (newCurrent >= buildingLimit.limit) {
                    toolbarItem.classList.add('disabled');
                } else {
                    toolbarItem.classList.remove('disabled');
                }
            }
        }
    }
}
