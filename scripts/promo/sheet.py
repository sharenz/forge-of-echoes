import sys,glob
from PIL import Image, ImageDraw
files=sorted(glob.glob(sys.argv[1]))[: int(sys.argv[3]) if len(sys.argv)>3 else 12]
cols=3; w=640; h=360
rows=(len(files)+cols-1)//cols
sh=Image.new('RGB',(cols*w,rows*h))
for i,f in enumerate(files):
    im=Image.open(f).convert('RGB').resize((w,h),Image.LANCZOS)
    ImageDraw.Draw(im).text((6,6),f.split('/')[-1][-30:],fill=(255,255,0))
    sh.paste(im,((i%cols)*w,(i//cols)*h))
sh.save(sys.argv[2])
