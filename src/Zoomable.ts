import {BrowserType, Client} from "react-client-info";

export type ZoomableProperties = {
    canZoom?:boolean
    maxZoom?:number
    onZoomStarted?:(state:ZoomableState)=>void
    onZoomChanged?:(state:ZoomableState)=>void
    onZoomCompleted?:(state:ZoomableState)=>void

    canPan?:boolean
    onPanStarted?:(state:ZoomableState)=>void
    onPanChanged?:(state:ZoomableState)=>void
    onPanCompleted?:(state:ZoomableState)=>void
}

export type ZoomableState = {
    scale: number
    posX: number;
    posY: number

    startScale: number
    startX: number
    startY: number

    isDragging: boolean
    isZooming: boolean
}

export type DerivedZoomableState = ZoomableState & {
    listeners:{[listener: string]: any}
    gestureStartScale: number
    touchStartWidth: number
    tappedTwice: boolean
}

let elements = new Map<HTMLElement, DerivedZoomableState>();

function getState(element:HTMLElement):DerivedZoomableState  {
    const state = elements.get(element);
    if (state) {
        //remove all existing listeners
        for (let type in state.listeners) {
            const listener = state.listeners[type];
            element.removeEventListener(type, listener)
        }
        return state
    }

    return {
        listeners:{},
        gestureStartScale: 0,
        scale: 1,

        touchStartWidth: 0,
        tappedTwice: false,

        //Movement
        isDragging: false,
        isZooming: false,
        posX: 0,
        posY: 0,
        startScale: 1,
        startX: 0,
        startY: 0,
    }

}

export function Zoomable(element:HTMLElement, settings?:ZoomableProperties) {

    const props = settings ? settings : {};
    let zoomRate = 0.001;
    if (Client.hasTouchpad || Client.isMobile) {
        zoomRate = 0.01
    } else if (Client.browser === BrowserType.Firefox) {
        zoomRate = 0.1
    }
    const maxScale = props.maxZoom ? props.maxZoom : 3.0;
    let lastScale = 1;
    let autoScalingHandler = 0;

    let state = getState(element);

    let needsRefresh = false;

    if (props.maxZoom) {
        if (state.scale > props.maxZoom) {
            state.scale = props.maxZoom;
            needsRefresh = true
        }
    }

    if (needsRefresh) {
        moveElements()
    }

    //add and keep track of listeners
    function addEventListener(element:HTMLElement, type: string, listener: any) {
        element.addEventListener(type, listener);
        state.listeners[type] = listener
    }

    //add event listeners
    if (Client.isMobile) {
        addEventListener(element,"touchstart", handleTouchStart);
        addEventListener(element,"touchmove", handleTouchMove);
        addEventListener(element,"touchend", handleTouchEnd)
    } else {

        if (Client.hasGestureSupport) {
            addEventListener(element, "gesturestart", handleGestureStart);
            addEventListener(element,"gesturechange", handleGestureChange);
            addEventListener(element,"gestureend", handleGestureEnd);
        } else {
            addEventListener(element,'wheel', handleWheelEvent);
        }

        addEventListener(element,"mousedown", handleMouseDown);
        addEventListener(element,"mousemove", handleMouseMove);
        addEventListener(element,"mouseup", handleMouseUp);
        addEventListener(element,"mouseleave", handleMouseCancel);
        addEventListener(element,"mouseout", handleMouseCancel);
        addEventListener(element,"contextmenu", handleClick)
    }

    elements.set(element, state);

    function handleMouseDown(e: MouseEvent) {
        e.preventDefault();
        dragStart(e)
    }

    function handleMouseMove(e: MouseEvent) {
        e.preventDefault();
        dragMove(e)
    }

    function handleMouseUp(e: MouseEvent) {
        e.preventDefault();
        dragEnd()
    }

    function handleMouseCancel(e: MouseEvent) {
        e.preventDefault();
        dragEnd()
    }

    function handleClick(e: Event) {
        e.cancelBubble = true;
        e.preventDefault();
        dragEnd()
    }

    function onZoomStarted() {
        if (props.maxZoom === 1.0) return;

        if (props.onZoomStarted) {
            props.onZoomStarted(state)
        }

        state.startScale = state.scale;
        //console.log(`Zoom started at (${state.startX}, ${state.startY})`)
        state.isZooming = true
    }

    function onZoomChanged() {
        if (props.maxZoom === 1.0) return;

        if (props.onZoomChanged) {
            props.onZoomChanged(state)
        }
    }

    function onZoomCompleted() {
        if (props.maxZoom === 1.0) return;

        if (props.onZoomCompleted) {
            props.onZoomCompleted(state)
        }
        //console.log("Zoom completed")
        state.isZooming = false
    }

    //Mouse events
    function handleWheelEvent(e: WheelEvent) {
        e.preventDefault();

        if (e.ctrlKey || !Client.hasGestureSupport) {
            if (e.deltaY === 0 && e.deltaX === 0 && Client.browser === BrowserType.Chrome && Client.hasTouchpad) {
                twoFingerTap() //two finger tap works like this on mac trackpads in chrome
            } else {
                state.scale = restrictScale(state.scale - e.deltaY * zoomRate);

                if (!state.isDragging && !state.isZooming) {
                    state.startX = e.clientX - state.posX;
                    state.startY = e.clientY - state.posY;
                    onZoomStarted()
                }
            }

            adjustZoomPosition(e.clientX, e.clientY)
        } else {
            state.posX = state.posX - e.deltaX * 2;
            state.posY = state.posY - e.deltaY * 2
        }

        moveElements();
    }

    //Mobile touch events:
    function handleTouchStart(e: TouchEvent) {
        e.preventDefault();

        if (state.isZooming) return;

        if (e.targetTouches.length === 2) {

            const xPos = (e.touches[0].clientX + e.touches[1].clientX) / 2.0;
            const yPos = (e.touches[0].clientY + e.touches[1].clientY) / 2.0;

            state.startX = xPos - state.posX;
            state.startY = yPos - state.posY;

            state.touchStartWidth = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
            state.gestureStartScale = restrictScale(state.scale);

            twoFingerStart()
        } else if (props.canPan !== false && !state.isZooming) {
            state.isDragging = true;
            state.startX = e.touches[0].pageX - state.posX;
            state.startY = e.touches[0].pageY - state.posY;
        }
    }

    function handleTouchMove(e: TouchEvent) {
        e.preventDefault();

        if (autoScalingHandler) return;

        if (e.targetTouches.length === 2) {
            state.tappedTwice = false;

            const xPos = (e.touches[0].clientX + e.touches[1].clientX) / 2.0;
            const yPos = (e.touches[0].clientY + e.touches[1].clientY) / 2.0;

            const touchWidth = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
            const scaleNow = touchWidth / state.touchStartWidth;
            state.scale = restrictScale(state.gestureStartScale * scaleNow);

            state.posX = xPos - state.startX;
            state.posY = yPos - state.startY

        } else if (props.canPan !== false && state.isDragging) {
            const xPos = e.touches[0].clientX;
            const yPos = e.touches[0].clientY;
            state.posX = xPos - state.startX;
            state.posY = yPos - state.startY
        }

        moveElements();
    }

    function handleTouchEnd(e: TouchEvent) {
        e.preventDefault();

        //snap to 1
        if (state.scale < 1.1) {
            state.scale = 1.0;
            moveElements()
        }

        if (state.isZooming) {
            window.setTimeout(()=> {
                state.isZooming = false;
                onZoomCompleted()
            }, 100)
        }
        state.isDragging = false
    }

    //Gesture events
    function handleGestureStart(e: Event) {
        e.preventDefault();

        const event = e as MouseEvent;
        if (event) {
            state.startX = event.pageX - state.posX;
            state.startY = event.pageY - state.posY;
        }

        state.gestureStartScale = restrictScale(state.scale);

        twoFingerStart()
    }

    function handleGestureChange(e: Event) {
        e.preventDefault();

        if (autoScalingHandler) return;

        const event = e as MouseEvent;

        if (event) {
            state.scale = restrictScale(state.gestureStartScale * (event as any).scale);

            state.posX = event.pageX - state.startX;
            state.posY = event.pageY - state.startY;

            adjustZoomPosition(event.clientX, event.clientY)
        }

        moveElements();
    }

    function handleGestureEnd(e: Event) {
        e.preventDefault();

        if (state.scale < 1.1) {
            state.scale = 1.0;
            moveElements()
        }
    }

    function dragStart(e: MouseEvent) {

        if (autoScalingHandler || e.ctrlKey || props.canPan === false) return;

        if (state.isZooming) {
            onZoomCompleted()
        }

        //console.log("Drag started")
        state.isDragging = true;
        state.startX = e.pageX - state.posX;
        state.startY = e.pageY - state.posY;
    }

    function dragMove(e: MouseEvent) {
        if (state.isZooming) {
            onZoomCompleted()
        }

        if (state.isDragging) {
            state.posX = e.pageX - state.startX;
            state.posY = e.pageY - state.startY;
            moveElements()
        }
    }

    function dragEnd() {
        if (!state.isDragging) return;
        state.isDragging = false
        //console.log("Drag completed")
    }

    //Logic functions
    function restrictScale(value: number): number {
        return Math.max(1.0, Math.min(maxScale, value));
    }

    function restrictX(scale: number, value: number): number {
        const parentWidth = element.parentElement ? element.parentElement.getBoundingClientRect().width : document.body.clientWidth;
        const halfChildWidth = element.clientWidth * scale * 0.5;

        value = Math.min(halfChildWidth - parentWidth / 2, value);
        value = Math.max(parentWidth / 2 - halfChildWidth, value);

        return value;
    }

    function restrictY(scale: number, value: number): number {
        const parentHeight = element.parentElement ? element.parentElement.getBoundingClientRect().height : document.body.clientHeight;
        const halfChildHeight = element.clientHeight * scale * 0.5;

        value = Math.min(halfChildHeight - parentHeight / 2, value);
        value = Math.max(parentHeight / 2 - halfChildHeight, value);

        return value;
    }

    function moveElements() {
        state.posX = restrictX(state.scale, state.posX);
        state.posY = restrictY(state.scale, state.posY);

        window.requestAnimationFrame(() => {
            element.style.transform = `translate3D(${state.posX}px, ${state.posY}px, 0px) scale(${state.scale})`
        });

        if (state.isZooming && lastScale !== state.scale) {
            onZoomChanged()
        }

        lastScale = state.scale
    }

    function adjustZoomPosition(xPos:number, yPos: number) {

        const rect = element.parentElement!.getBoundingClientRect();

        const distX = (rect.left - xPos + rect.width / 2.0);
        const distY = (rect.top - yPos + rect.height / 2.0);
        state.posX = - distX * (1 - state.scale);
        state.posY = - state.scale - distY * (1 - state.scale)
    }

    function twoFingerStart() {

        if (!state.isDragging && !state.isZooming) {
            onZoomStarted()
        }

        if (!state.tappedTwice) {
            state.tappedTwice = true;
            setTimeout(function () {
                state.tappedTwice = false;
            }, 500);
        } else {
            twoFingerTap()
        }
    }

    function twoFingerTap() {
        if (autoScalingHandler !== 0) return;
        const endScale = state.scale < maxScale / 2 ? maxScale : 1;
        autoScalingHandler = window.setInterval(() => {
            state.scale = (endScale + state.scale) / 2.0;
            moveElements()
        }, 50);
        setTimeout(function () {
            clearInterval(autoScalingHandler);
            autoScalingHandler = 0;
            state.scale = endScale;
            moveElements()
        }, 500);
    }
}