import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

// Puts keyboard focus on the element it's on as soon as that element appears on the page.
//
// Used on the Cancel button of every "are you sure?" box. The box replaces the button that was
// just clicked, so without this a keyboard user's focus would be lost with the button that
// disappeared. Cancel rather than the destructive button, so pressing Enter straight away backs
// out instead of deleting something.
//
// The HTML autofocus attribute can't do this job: browsers only honour it when the page first
// loads, not on an element added later, which is what an @if block does.
@Directive({
  selector: '[appAutofocus]',
})
export class Autofocus {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef);
    // after the render, because before it the element isn't attached to the page and can't take focus
    afterNextRender(() => element.nativeElement.focus());
  }
}
