//! Cell render pipeline. One draw call per frame, instanced over visible cells.
//!
//! Layout follows WezTerm's `quad.rs` (instance-per-cell, 6 vertices per quad
//! generated from `vertex_index` so we don't need a vertex buffer).

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::atlas::Atlas;

/// One GPU instance per visible terminal cell. Fields match `cell.wgsl` locations 0..6.
/// Now that the atlas stores cell-sized slots, the shader no longer needs
/// `bearing` or `glyph_size` — `(uv_min, uv_max)` covers the full cell rect.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct CellInstance {
    pub grid_pos: [f32; 2],
    pub atlas_uv_min: [f32; 2],
    pub atlas_uv_max: [f32; 2],
    pub fg: [f32; 4],
    pub bg: [f32; 4],
    /// Bit 0: underline. Reserved bits 1..7 for future styling.
    pub flags: u32,
    /// Cell display width: 1 for normal, 2 for CJK / emoji wide grapheme.
    /// Drives the quad horizontal scale in the vertex shader.
    pub width: u32,
}

pub const FLAG_UNDERLINE: u32 = 1 << 0;
pub const FLAG_BOLD: u32 = 1 << 1;
pub const FLAG_ITALIC: u32 = 1 << 2;
pub const FLAG_STRIKE: u32 = 1 << 3;
/// Underline style: when FLAG_UNDERLINE is set, the highest of these wins.
/// Default (no flag set) = single. Multiple set = single (degrades cleanly).
pub const FLAG_UL_DOUBLE: u32 = 1 << 4;
pub const FLAG_UL_CURLY: u32 = 1 << 5;
pub const FLAG_UL_DOTTED: u32 = 1 << 6;
pub const FLAG_UL_DASHED: u32 = 1 << 7;
/// Glyph stores premultiplied RGBA (color emoji). When set the fragment
/// shader composites the sample over `bg` instead of `mix(bg, fg, alpha)`.
pub const FLAG_COLOR_GLYPH: u32 = 1 << 8;
/// SGR 2 (faint/dim): fg is blended 50% toward bg before the coverage mix.
/// Skipped on color glyphs (same rule as bold).
pub const FLAG_DIM: u32 = 1 << 9;

impl CellInstance {
    pub const SIZE: u64 = std::mem::size_of::<Self>() as u64;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Uniforms {
    pub cell_size: [f32; 2],
    pub viewport: [f32; 2],
    pub atlas_size: [f32; 2],
    /// 1.0 → fragment shader encodes its linear output to sRGB (used when the
    /// canvas surface is NOT an `*Srgb` format, which is the WebGPU default).
    /// 0.0 → leave the conversion to the GPU surface (true sRGB target).
    pub srgb_at_output: f32,
    pub _pad: f32,
}

const INITIAL_INSTANCE_CAPACITY: u64 = 4096;

pub struct Pipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    bind_group: wgpu::BindGroup,
    instance_buffer: wgpu::Buffer,
    instance_capacity: u64,
    uniform_buffer: wgpu::Buffer,
}

impl Pipeline {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, atlas: &Atlas) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("arkadia-cell-shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/cell.wgsl").into()),
        });

        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("arkadia-cell-bgl"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("arkadia-uniforms"),
            contents: bytemuck::cast_slice(&[Uniforms {
                cell_size: [10.0, 18.0],
                viewport: [1.0, 1.0],
                atlas_size: [1024.0, 1024.0],
                srgb_at_output: 0.0,
                _pad: 0.0,
            }]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("arkadia-cell-bg"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(atlas.view()),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(atlas.sampler()),
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("arkadia-cell-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let attributes = [
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x2,
                offset: 0,
                shader_location: 0,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x2,
                offset: 8,
                shader_location: 1,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x2,
                offset: 16,
                shader_location: 2,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 24,
                shader_location: 3,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 40,
                shader_location: 4,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Uint32,
                offset: 56,
                shader_location: 5,
            },
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Uint32,
                offset: 60,
                shader_location: 6,
            },
        ];
        let vertex_buffer_layout = wgpu::VertexBufferLayout {
            array_stride: CellInstance::SIZE,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &attributes,
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("arkadia-cell-rp"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                buffers: &[vertex_buffer_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("arkadia-instances"),
            size: CellInstance::SIZE * INITIAL_INSTANCE_CAPACITY,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            pipeline,
            bind_group_layout,
            bind_group,
            instance_buffer,
            instance_capacity: INITIAL_INSTANCE_CAPACITY,
            uniform_buffer,
        }
    }

    pub fn update_uniforms(&self, queue: &wgpu::Queue, uniforms: &Uniforms) {
        queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(uniforms));
    }

    /// Rebuilds the bind group when the atlas texture/sampler are recreated
    /// (currently never, but kept for future cell-size changes).
    pub fn rebuild_bind_group(&mut self, device: &wgpu::Device, atlas: &Atlas) {
        self.bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("arkadia-cell-bg"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(atlas.view()),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(atlas.sampler()),
                },
            ],
        });
    }

    pub fn write_instances(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        instances: &[CellInstance],
    ) {
        let needed = instances.len() as u64;
        if needed == 0 {
            return;
        }
        if needed > self.instance_capacity {
            // Grow the buffer with a generous headroom. ConPTY rarely jumps to
            // 200×60 then back to 80×24 — we don't bother shrinking.
            let mut cap = self.instance_capacity.max(1);
            while cap < needed {
                cap *= 2;
            }
            self.instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("arkadia-instances"),
                size: CellInstance::SIZE * cap,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.instance_capacity = cap;
        }
        queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(instances));
    }

    pub fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, n_instances: u32) {
        if n_instances == 0 {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, self.instance_buffer.slice(..));
        pass.draw(0..6, 0..n_instances);
    }
}
