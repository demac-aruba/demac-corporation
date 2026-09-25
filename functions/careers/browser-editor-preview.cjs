'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
/** Exercise the real editor's current draft; never submit to an authority. */
module.exports=async function verifyEditorPreview({office,title,spanishTitle,output,name}){
  const location=office.url(),writes=[];
  const review=office.getByLabel('I reviewed this Spanish translation against the current English version.',{exact:true});
  const originalReview=await review.isChecked();
  const englishText=await office.getByLabel('About the role',{exact:true}).inputValue();
  const remember=request=>{
    if(request.method()==='POST'&&/\/careers(?:Admin|Public)$/.test(new URL(request.url()).pathname))writes.push(request.postDataJSON()?.action);
  };
  office.on('request',remember);
  try {
    const open=office.getByRole('button',{name:'Previsualizar en español',exact:true});
    assert(await open.isEnabled(),'a complete draft can be inspected before approval');
    await open.click();
    const dialog=office.locator('[data-editor-candidate-preview]');
    await dialog.waitFor();
    assert(await dialog.evaluate(el=>el.open&&el.matches(':modal')),'native modal is open');
    assert(await dialog.evaluate(el=>!el.closest('form')),'preview form is outside the administrative form');
    await dialog.getByRole('heading',{name:spanishTitle,exact:true}).waitFor();
    await office.screenshot({path:path.join(output,`${name}-editor-preview-es-role.png`),fullPage:true});
    await dialog.getByRole('button',{name:'Aplicar ahora',exact:true}).click();
    await dialog.locator('#givenName').fill('  Editorial QA  ');
    await dialog.locator('#givenName').press('Enter');
    await dialog.locator('#familyName').waitFor();
    // A React portal still bubbles events to its React parents. The dialog must
    // isolate submit events: Continue/Enter must never submit the outer editor.
    assert.equal(office.url(),location);assert.deepEqual(writes,[],'preview Continue must not save a vacancy');
    await dialog.getByRole('button',{name:'English',exact:true}).click();
    await dialog.getByRole('heading',{name:'What is your last name?',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Back to previous question',exact:true}).click();
    assert.equal(await dialog.locator('#givenName').inputValue(),'  Editorial QA  ');
    await office.setViewportSize({width:390,height:844});
    assert(await office.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no mobile document overflow');
    assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no mobile modal overflow');
    await office.screenshot({path:path.join(output,`${name}-editor-preview-en-question-mobile.png`),fullPage:true});
    await dialog.getByRole('button',{name:'Español',exact:true}).click();
    assert.equal(await dialog.locator('#givenName').inputValue(),'  Editorial QA  ');
    await office.screenshot({path:path.join(output,`${name}-editor-preview-es-question-mobile.png`),fullPage:true});
    await office.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert.equal(await office.getByLabel('Job title',{exact:true}).inputValue(),title);
    assert.equal(await office.getByLabel('About the role',{exact:true}).inputValue(),englishText);
    assert.equal(await office.getByLabel('Título del puesto · Español',{exact:true}).inputValue(),spanishTitle);
    assert.equal(await review.isChecked(),originalReview,'preview must not approve the Spanish source');
    await office.getByRole('button',{name:'Preview in English',exact:true}).click();
    await dialog.getByRole('heading',{name:title,exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Apply now',exact:true}).click();
    assert.equal(await dialog.locator('#givenName').inputValue(),'','reopened preview drops only simulated candidate data');
    await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal(office.url(),location);assert.deepEqual(writes,[],'editor preview never contacts the Careers authorities');
  } finally {office.off('request',remember);await office.setViewportSize({width:1440,height:1000});}
};
