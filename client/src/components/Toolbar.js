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
        this.color = this._normalizeHexColor(newColor) || "#60eaff";
        this.items.forEach((itemClass, index) => {
            const toolbarItem = this.container.querySelector(`.toolbar-item-${index}`);
            const item = new itemClass(this.color);
            const iconCanvas = this.createIconCanvas(item, this._getToolbarIconScale(item));
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
                const activeType = this.core.buildingManager?.selectedPlacementType;
                if (activeType === item.type) {
                    this.core.buildingManager?.removeBuildingToPlace?.();
                } else if (this.onSelectBuilding) {
                    this.onSelectBuilding(itemClass);
                }
                this.core.uiManager.hideUpgrades();
            } else {
                console.error(`Cannot select ${details.name}. Limit of ${buildingLimit.limit} reached.`);
            }
        });

        const iconCanvas = this.createIconCanvas(item, this._getToolbarIconScale(item));
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

    _getToolbarIconScale (item) {
        const name = String(item?.details?.name || "").toLowerCase();

        // These icons are visually denser and looked clipped/tight after toolbar downsizing.
        if (name.includes("portal")) return 0.76;
        if (name.includes("armory")) return 0.8;

        return 0.86;
    }

    createIconCanvas (item, scale) {
        const iconCanvas = document.createElement("canvas");
        iconCanvas.width = 80;
        iconCanvas.height = 80;
        const iconContext = iconCanvas.getContext("2d");
        const rgb = this._hexToRgb(this.color) || { r: 96, g: 234, b: 255 };
        const strong = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`;
        const mid = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.74)`;
        const soft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`;
        const glow = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.38)`;
        const coreGlow = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24)`;

        const w = iconCanvas.width;
        const h = iconCanvas.height;
        const padding = 7;
        const innerW = w - padding * 2;
        const innerH = h - padding * 2;

        // Deep panel background
        const panelGradient = iconContext.createLinearGradient(0, 0, w, h);
        panelGradient.addColorStop(0, "rgba(8, 12, 34, 0.98)");
        panelGradient.addColorStop(0.5, "rgba(16, 16, 54, 0.96)");
        panelGradient.addColorStop(1, "rgba(7, 23, 56, 0.98)");
        iconContext.fillStyle = panelGradient;
        this._roundedRect(iconContext, 2, 2, w - 4, h - 4, 12);
        iconContext.fill();

        // Ambient outer glow
        iconContext.shadowBlur = 16;
        iconContext.shadowColor = glow;
        iconContext.strokeStyle = "rgba(140, 150, 255, 0.22)";
        iconContext.lineWidth = 1.3;
        this._roundedRect(iconContext, 1.6, 1.6, w - 3.2, h - 3.2, 13);
        iconContext.stroke();

        // Neon border (outer)
        iconContext.shadowBlur = 14;
        iconContext.shadowColor = this.color;
        iconContext.strokeStyle = strong;
        iconContext.lineWidth = 1.8;
        this._roundedRect(iconContext, 4, 4, w - 8, h - 8, 10.5);
        iconContext.stroke();
        iconContext.shadowBlur = 0;

        // Inner accent border
        iconContext.strokeStyle = "rgba(220, 230, 255, 0.32)";
        iconContext.lineWidth = 1;
        this._roundedRect(iconContext, 7, 7, w - 14, h - 14, 8.5);
        iconContext.stroke();

        // Energy ring behind icon
        const ringGradient = iconContext.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, 32);
        ringGradient.addColorStop(0, coreGlow);
        ringGradient.addColorStop(0.55, soft);
        ringGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        iconContext.fillStyle = ringGradient;
        iconContext.beginPath();
        iconContext.arc(w / 2, h / 2, 28, 0, Math.PI * 2);
        iconContext.fill();

        // Scan lines (subtle)
        iconContext.strokeStyle = soft;
        iconContext.lineWidth = 1;
        for (let y = 12; y < h - 10; y += 5) {
            iconContext.beginPath();
            iconContext.moveTo(10, y);
            iconContext.lineTo(w - 10, y);
            iconContext.stroke();
        }

        // Corner accents
        iconContext.strokeStyle = mid;
        iconContext.lineWidth = 2.2;
        const c = 8;
        const e = 15;
        this._drawCorner(iconContext, c, c, e, e);
        this._drawCorner(iconContext, w - c, c, -e, e);
        this._drawCorner(iconContext, c, h - c, e, -e);
        this._drawCorner(iconContext, w - c, h - c, -e, -e);

        // Render building icon in center area
        iconContext.save();
        this._roundedRect(iconContext, padding, padding, innerW, innerH, 9);
        iconContext.clip();
        iconContext.translate(w / 2, h / 2);
        iconContext.scale(scale, scale);
        iconContext.lineJoin = "round";
        iconContext.lineCap = "round";
        iconContext.shadowBlur = 10;
        iconContext.shadowColor = coreGlow;
        item.render(iconContext, { x: 0, y: 0 }, 0);
        iconContext.restore();

        return iconCanvas;
    }

    _roundedRect (ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    _drawCorner (ctx, x, y, dx, dy) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * 0.35);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * 0.35, y);
        ctx.stroke();
    }

    _normalizeHexColor (value) {
        if (!value) return null;

        if (Array.isArray(value) && value.length >= 3) {
            const [r, g, b] = value.map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
            return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        }

        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
        if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
            return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
        }
        return null;
    }

    _hexToRgb (hex) {
        const normalized = this._normalizeHexColor(hex);
        if (!normalized) return null;
        const intVal = parseInt(normalized.slice(1), 16);
        return {
            r: (intVal >> 16) & 255,
            g: (intVal >> 8) & 255,
            b: intVal & 255
        };
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
                const activeType = this.core.buildingManager?.selectedPlacementType;
                if (activeType === item.type) {
                    this.core.buildingManager?.removeBuildingToPlace?.();
                } else if (this.onSelectBuilding) {
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

    setActiveBuildingType (buildingType) {
        if (!this.container) return;

        this.container.querySelectorAll(".toolbar-item-active").forEach((item) => {
            item.classList.remove("toolbar-item-active");
        });

        if (buildingType === null || buildingType === undefined) return;

        const activeItem = this.container.querySelector(`[data-building-type="${buildingType}"]`);
        if (activeItem) {
            activeItem.classList.add("toolbar-item-active");
        }
    }
}
