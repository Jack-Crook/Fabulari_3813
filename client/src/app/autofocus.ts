import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

// focuses its element as soon as it appears. used on Cancel in every confirm box, so keyboard
// focus isn't lost and Enter backs out. the html autofocus attribute only works on page load,
// not on elements an @if adds later.
@Directive({
  selector: '[appAutofocus]',
})
export class Autofocus {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef);
    // after render, once the element is on the page
    afterNextRender(() => element.nativeElement.focus());
  }
}
